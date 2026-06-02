using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.IO.Compression;
using System.Net;
using System.Reflection;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;
using System.Windows.Forms;

namespace VideoPlaybackHelperLauncher
{
    internal sealed class Job
    {
        public string id { get; set; }
        public string label { get; set; }
        public string status { get; set; }
        public double percent { get; set; }
        public string speed { get; set; }
        public string message { get; set; }
    }

    internal sealed class JobsResponse
    {
        public bool ok { get; set; }
        public Job[] jobs { get; set; }
    }

    internal sealed class HealthResponse
    {
        public bool ok { get; set; }
    }

    internal sealed class HelperForm : Form
    {
        private const string AppName = "Video Playback Helper";
        private const string HealthUrl = "http://127.0.0.1:47829/health";
        private const string JobsUrl = "http://127.0.0.1:47829/jobs";
        private const string NodeVersion = "v22.16.0";
        private const string NodeArchiveName = "node-" + NodeVersion + "-win-x64.zip";
        private const string NodeDownloadUrl = "https://nodejs.org/dist/" + NodeVersion + "/" + NodeArchiveName;

        private static readonly string RuntimeRoot = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            AppName
        );

        private readonly JavaScriptSerializer json = new JavaScriptSerializer();
        private readonly Dictionary<string, bool> notifications = new Dictionary<string, bool>();
        private readonly Mutex singleInstanceMutex;
        private readonly bool createdNewInstance;

        private Process serverProcess;
        private Icon helperIcon;
        private bool isClosing;
        private Label statusLabel;
        private Button stopSelectedButton;
        private Button downloadsButton;
        private ListView jobsListView;
        private TextBox jobDetailsTextBox;
        private NotifyIcon notifyIcon;
        private System.Windows.Forms.Timer timer;

        public HelperForm()
        {
            singleInstanceMutex = new Mutex(true, "Global\\VideoPlaybackHelperSingleInstance", out createdNewInstance);

            if (!createdNewInstance)
            {
                MessageBox.Show(
                    "Video Playback Helper is already running.",
                    AppName,
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Information
                );
                Environment.Exit(0);
                return;
            }

            PrepareRuntime();
            LoadHelperIcon();
            BuildUi();
            BuildTray();
            HookEvents();
        }

        private static void ExtractResource(string resourceName, string relativePath)
        {
            string targetPath = Path.Combine(RuntimeRoot, relativePath);
            string targetDirectory = Path.GetDirectoryName(targetPath);

            if (!Directory.Exists(targetDirectory))
            {
                Directory.CreateDirectory(targetDirectory);
            }

            using (Stream input = Assembly.GetExecutingAssembly().GetManifestResourceStream(resourceName))
            {
                if (input == null)
                {
                    throw new FileNotFoundException("Missing embedded resource: " + resourceName);
                }

                using (FileStream output = File.Create(targetPath))
                {
                    input.CopyTo(output);
                }
            }
        }

        private static string RuntimePath(string relativePath)
        {
            return Path.Combine(RuntimeRoot, relativePath);
        }

        private static string LocalNodePath()
        {
            return RuntimePath("tools\\node\\node.exe");
        }

        private void PrepareRuntime()
        {
            ExtractResource("helper-icon.ico", "utils\\helper-icon.ico");
            ExtractResource("install-ytdlp.js", "utils\\install-ytdlp.js");
            ExtractResource("install-ffmpeg.js", "utils\\install-ffmpeg.js");
            ExtractResource("install-aria2.js", "utils\\install-aria2.js");
            ExtractResource("ytdlp-server.js", "utils\\ytdlp-server.js");
        }

        private void LoadHelperIcon()
        {
            string iconPath = RuntimePath("utils\\helper-icon.ico");

            if (File.Exists(iconPath))
            {
                helperIcon = new Icon(iconPath);
            }
        }

        private void BuildUi()
        {
            Text = AppName;
            Width = 620;
            Height = 430;
            FormBorderStyle = FormBorderStyle.FixedSingle;
            MaximizeBox = false;
            StartPosition = FormStartPosition.Manual;
            BackColor = Color.FromArgb(35, 39, 48);
            ForeColor = Color.White;
            Font = new Font("Segoe UI", 9);

            if (helperIcon != null)
            {
                Icon = helperIcon;
            }

            Label titleLabel = new Label
            {
                Text = AppName,
                Font = new Font("Segoe UI", 11, FontStyle.Bold),
                AutoSize = true,
                Location = new Point(16, 14)
            };
            Controls.Add(titleLabel);

            statusLabel = new Label
            {
                Text = "Initializing...",
                AutoSize = true,
                Location = new Point(18, 48)
            };
            Controls.Add(statusLabel);

            stopSelectedButton = new Button
            {
                Text = "Stop DL",
                Width = 82,
                Height = 28,
                Location = new Point(18, 86),
                Enabled = false
            };
            stopSelectedButton.Click += delegate { StopSelectedJob(); };
            Controls.Add(stopSelectedButton);

            downloadsButton = new Button
            {
                Text = "Downloads",
                Width = 82,
                Height = 28,
                Location = new Point(108, 86)
            };
            downloadsButton.Click += delegate { Process.Start(GetDownloadsPath()); };
            Controls.Add(downloadsButton);

            Label hintLabel = new Label
            {
                Text = "Minimize to keep the helper in the bottom-right corner.",
                AutoSize = true,
                ForeColor = Color.Silver,
                Location = new Point(18, 122)
            };
            Controls.Add(hintLabel);

            jobsListView = new ListView
            {
                View = View.Details,
                FullRowSelect = true,
                GridLines = false,
                Width = 574,
                Height = 150,
                Location = new Point(18, 148),
                BackColor = Color.FromArgb(28, 31, 38),
                ForeColor = Color.White
            };
            jobsListView.Columns.Add("Download", 190);
            jobsListView.Columns.Add("%", 48);
            jobsListView.Columns.Add("Speed", 82);
            jobsListView.Columns.Add("Message", 248);
            jobsListView.Columns.Add("Status", 0);
            jobsListView.SelectedIndexChanged += delegate { UpdateSelectedJobDetails(); };
            Controls.Add(jobsListView);

            jobDetailsTextBox = new TextBox
            {
                Multiline = true,
                ReadOnly = true,
                ScrollBars = ScrollBars.Vertical,
                Width = 574,
                Height = 64,
                Location = new Point(18, 306),
                BackColor = Color.FromArgb(28, 31, 38),
                ForeColor = Color.White
            };
            Controls.Add(jobDetailsTextBox);
        }

        private void BuildTray()
        {
            ContextMenuStrip contextMenu = new ContextMenuStrip();
            contextMenu.Items.Add("Show").Click += delegate
            {
                Show();
                WindowState = FormWindowState.Normal;
                PlaceBottomRight();
            };
            contextMenu.Items.Add("Open downloads").Click += delegate { Process.Start(GetDownloadsPath()); };
            contextMenu.Items.Add("-");
            contextMenu.Items.Add("Exit").Click += delegate
            {
                isClosing = true;
                StopHelper();
                notifyIcon.Visible = false;
                Close();
            };

            notifyIcon = new NotifyIcon
            {
                Icon = helperIcon ?? SystemIcons.Application,
                Visible = true,
                Text = AppName,
                ContextMenuStrip = contextMenu
            };
            notifyIcon.DoubleClick += delegate
            {
                Show();
                WindowState = FormWindowState.Normal;
                PlaceBottomRight();
            };
        }

        private void HookEvents()
        {
            Load += delegate
            {
                PlaceBottomRight();
                StartHelper();
            };

            Resize += delegate
            {
                if (WindowState == FormWindowState.Minimized)
                {
                    Hide();
                    notifyIcon.ShowBalloonTip(
                        1200,
                        AppName,
                        "The helper is still running in the background.",
                        ToolTipIcon.Info
                    );
                }
            };

            FormClosing += delegate(object sender, FormClosingEventArgs args)
            {
                if (!isClosing)
                {
                    args.Cancel = true;
                    WindowState = FormWindowState.Minimized;
                }
            };

            FormClosed += delegate
            {
                if (timer != null)
                {
                    timer.Stop();
                    timer.Dispose();
                }

                if (notifyIcon != null)
                {
                    notifyIcon.Dispose();
                }

                if (helperIcon != null)
                {
                    helperIcon.Dispose();
                }

                if (singleInstanceMutex != null)
                {
                    singleInstanceMutex.ReleaseMutex();
                    singleInstanceMutex.Dispose();
                }
            };

            timer = new System.Windows.Forms.Timer { Interval = 1000 };
            timer.Tick += delegate { UpdateDownloadStatus(); };
            timer.Start();
        }

        private void PlaceBottomRight()
        {
            Rectangle screen = Screen.PrimaryScreen.WorkingArea;
            Location = new Point(screen.Right - Width - 16, screen.Bottom - Height - 16);
        }

        private static string GetDownloadsPath()
        {
            return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), "Downloads");
        }

        private static bool HasNode()
        {
            try
            {
                return RunProcess(ResolveNodeExecutable(), "--version", RuntimeRoot, true) == 0;
            }
            catch
            {
                return false;
            }
        }

        private static string ResolveNodeExecutable()
        {
            string localNode = LocalNodePath();

            if (File.Exists(localNode))
            {
                return localNode;
            }

            return "node";
        }

        private static void CopyDirectory(string sourceDirectory, string targetDirectory)
        {
            Directory.CreateDirectory(targetDirectory);

            foreach (string file in Directory.GetFiles(sourceDirectory))
            {
                File.Copy(file, Path.Combine(targetDirectory, Path.GetFileName(file)), true);
            }

            foreach (string directory in Directory.GetDirectories(sourceDirectory))
            {
                CopyDirectory(directory, Path.Combine(targetDirectory, Path.GetFileName(directory)));
            }
        }

        private bool EnsureNodeRuntime()
        {
            if (HasNode())
            {
                return true;
            }

            try
            {
                SetStatus("Installing portable Node.js...", Color.Khaki);

                Directory.CreateDirectory(RuntimePath("tools"));
                string tempDirectory = RuntimePath("tools\\node-download");
                string archivePath = Path.Combine(tempDirectory, NodeArchiveName);

                if (Directory.Exists(tempDirectory))
                {
                    Directory.Delete(tempDirectory, true);
                }

                Directory.CreateDirectory(tempDirectory);
                ServicePointManager.SecurityProtocol = (SecurityProtocolType)3072;

                using (WebClient client = new WebClient())
                {
                    client.Headers.Add("User-Agent", AppName);
                    client.DownloadFile(NodeDownloadUrl, archivePath);
                }

                ZipFile.ExtractToDirectory(archivePath, tempDirectory);
                string[] nodeFiles = Directory.GetFiles(tempDirectory, "node.exe", SearchOption.AllDirectories);

                if (nodeFiles.Length == 0)
                {
                    throw new FileNotFoundException("Portable node.exe was not found in the downloaded archive.");
                }

                string extractedNodeDirectory = Path.GetDirectoryName(nodeFiles[0]);
                string localNodeDirectory = RuntimePath("tools\\node");

                if (Directory.Exists(localNodeDirectory))
                {
                    Directory.Delete(localNodeDirectory, true);
                }

                CopyDirectory(extractedNodeDirectory, localNodeDirectory);
                Directory.Delete(tempDirectory, true);

                return File.Exists(LocalNodePath());
            }
            catch (Exception error)
            {
                MessageBox.Show(
                    "Unable to install portable Node.js automatically.\n\n" + error.Message,
                    AppName,
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Error
                );
                SetStatus("Node.js install failed", Color.LightCoral);
                return false;
            }
        }

        private static int RunProcess(string fileName, string arguments, string workingDirectory, bool wait)
        {
            ProcessStartInfo startInfo = new ProcessStartInfo
            {
                FileName = fileName,
                Arguments = arguments,
                WorkingDirectory = workingDirectory,
                UseShellExecute = false,
                CreateNoWindow = true,
                WindowStyle = ProcessWindowStyle.Hidden
            };

            Process process = Process.Start(startInfo);

            if (!wait)
            {
                return 0;
            }

            process.WaitForExit();
            int exitCode = process.ExitCode;
            process.Dispose();
            return exitCode;
        }

        private bool EnsureTools()
        {
            if (!EnsureNodeRuntime())
            {
                return false;
            }

            if (!File.Exists(RuntimePath("tools\\yt-dlp.exe")))
            {
                SetStatus("Installing yt-dlp...", Color.Khaki);

                if (RunProcess(ResolveNodeExecutable(), Quote(RuntimePath("utils\\install-ytdlp.js")), RuntimeRoot, true) != 0)
                {
                    SetStatus("yt-dlp could not be installed", Color.LightCoral);
                    return false;
                }
            }

            if (!File.Exists(RuntimePath("tools\\ffmpeg\\bin\\ffmpeg.exe")))
            {
                SetStatus("Installing ffmpeg...", Color.Khaki);

                if (RunProcess(ResolveNodeExecutable(), Quote(RuntimePath("utils\\install-ffmpeg.js")), RuntimeRoot, true) != 0)
                {
                    SetStatus("ffmpeg could not be installed", Color.LightCoral);
                    return false;
                }
            }

            if (!File.Exists(RuntimePath("tools\\aria2\\aria2c.exe")))
            {
                SetStatus("Installing aria2c...", Color.Khaki);

                if (RunProcess(ResolveNodeExecutable(), Quote(RuntimePath("utils\\install-aria2.js")), RuntimeRoot, true) != 0)
                {
                    SetStatus("aria2c unavailable, using standard mode", Color.Khaki);
                }
            }

            return true;
        }

        private static string Quote(string value)
        {
            return "\"" + value + "\"";
        }

        private T GetJson<T>(string url) where T : class
        {
            using (WebClient client = new WebClient())
            {
                client.Encoding = Encoding.UTF8;
                string response = client.DownloadString(url);
                return json.Deserialize<T>(response);
            }
        }

        private bool TestHelperAlive()
        {
            try
            {
                HealthResponse response = GetJson<HealthResponse>(HealthUrl);
                return response != null && response.ok;
            }
            catch
            {
                return false;
            }
        }

        private Job[] GetJobs()
        {
            try
            {
                JobsResponse response = GetJson<JobsResponse>(JobsUrl);

                if (response != null && response.ok && response.jobs != null)
                {
                    return response.jobs;
                }
            }
            catch
            {
            }

            return new Job[0];
        }

        private void StartHelper()
        {
            if (TestHelperAlive())
            {
                SetStatus("Ready", Color.LightGreen);
                return;
            }

            if (!EnsureTools())
            {
                return;
            }

            SetStatus("Starting...", Color.Khaki);

            ProcessStartInfo startInfo = new ProcessStartInfo
            {
                FileName = ResolveNodeExecutable(),
                Arguments = Quote(RuntimePath("utils\\ytdlp-server.js")),
                WorkingDirectory = RuntimeRoot,
                UseShellExecute = false,
                CreateNoWindow = true,
                WindowStyle = ProcessWindowStyle.Hidden
            };

            serverProcess = Process.Start(startInfo);
            Thread.Sleep(800);

            SetStatus(TestHelperAlive() ? "Ready" : "Startup error", TestHelperAlive() ? Color.LightGreen : Color.LightCoral);
        }

        private void StopHelper()
        {
            try
            {
                if (serverProcess != null && !serverProcess.HasExited)
                {
                    serverProcess.Kill();
                    serverProcess.Dispose();
                }
                else
                {
                    KillProcessListeningOnHelperPort();
                }
            }
            catch
            {
            }

            serverProcess = null;
            SetStatus("Stopped", Color.Gainsboro);
        }

        private static void KillProcessListeningOnHelperPort()
        {
            ProcessStartInfo startInfo = new ProcessStartInfo
            {
                FileName = "netstat.exe",
                Arguments = "-ano -p tcp",
                UseShellExecute = false,
                CreateNoWindow = true,
                RedirectStandardOutput = true
            };

            using (Process process = Process.Start(startInfo))
            {
                string output = process.StandardOutput.ReadToEnd();
                process.WaitForExit();

                foreach (string line in output.Split(new[] { "\r\n", "\n" }, StringSplitOptions.RemoveEmptyEntries))
                {
                    if (!line.Contains("127.0.0.1:47829") || !line.ToUpperInvariant().Contains("LISTENING"))
                    {
                        continue;
                    }

                    string[] parts = line.Split(new[] { ' ' }, StringSplitOptions.RemoveEmptyEntries);

                    if (parts.Length > 0)
                    {
                        int pid;

                        if (int.TryParse(parts[parts.Length - 1], out pid))
                        {
                            Process.GetProcessById(pid).Kill();
                        }
                    }
                }
            }
        }

        private void StopSelectedJob()
        {
            if (jobsListView.SelectedItems.Count == 0)
            {
                return;
            }

            ListViewItem selected = jobsListView.SelectedItems[0];
            string jobId = selected.Tag as string;
            string jobStatus = selected.SubItems[4].Text;

            if (string.IsNullOrEmpty(jobId))
            {
                return;
            }

            bool isFinished = IsFinished(jobStatus);
            string action = isFinished ? "delete" : "stop";

            try
            {
                HttpWebRequest request = (HttpWebRequest)WebRequest.Create(JobsUrl + "/" + jobId + "/" + action);
                request.Method = "DELETE";

                using (HttpWebResponse response = (HttpWebResponse)request.GetResponse())
                {
                }

                UpdateDownloadStatus();
            }
            catch
            {
                SetStatus("Action failed", Color.LightCoral);
            }
        }

        private static bool IsFinished(string status)
        {
            return status == "complete" || status == "error" || status == "cancelled";
        }

        private void UpdateSelectedJobDetails()
        {
            if (jobsListView.SelectedItems.Count == 0)
            {
                jobDetailsTextBox.Text = "";
                stopSelectedButton.Text = "Stop DL";
                stopSelectedButton.Enabled = false;
                return;
            }

            ListViewItem selected = jobsListView.SelectedItems[0];
            string jobStatus = selected.SubItems[4].Text;

            jobDetailsTextBox.Text = selected.SubItems[3].Text;
            stopSelectedButton.Text = IsFinished(jobStatus) ? "Delete" : "Stop DL";
            stopSelectedButton.Enabled = true;
        }

        private void UpdateDownloadStatus()
        {
            if (!TestHelperAlive())
            {
                return;
            }

            Job[] jobs = GetJobs();

            if (jobs.Length == 0)
            {
                jobsListView.Items.Clear();
                return;
            }

            string selectedJobId = jobsListView.SelectedItems.Count > 0
                ? jobsListView.SelectedItems[0].Tag as string
                : "";

            jobsListView.BeginUpdate();
            jobsListView.Items.Clear();

            foreach (Job job in jobs)
            {
                int percent = Math.Max(0, Math.Min(100, (int)Math.Round(job.percent)));
                ListViewItem item = new ListViewItem(job.label ?? "Media download");
                string status = job.status ?? "";

                item.Tag = job.id;
                item.SubItems.Add(percent + "%");
                item.SubItems.Add(!string.IsNullOrEmpty(job.speed) ? job.speed : status);
                item.SubItems.Add(job.message ?? "");
                item.SubItems.Add(status);
                jobsListView.Items.Add(item);

                if (!string.IsNullOrEmpty(selectedJobId) && selectedJobId == job.id)
                {
                    item.Selected = true;
                }
            }

            jobsListView.EndUpdate();
            UpdateSelectedJobDetails();
            UpdateStatusFromJobs(jobs);
            NotifyFinishedJobs(jobs);
        }

        private void UpdateStatusFromJobs(IEnumerable<Job> jobs)
        {
            int active = 0;
            int failed = 0;
            int completed = 0;

            foreach (Job job in jobs)
            {
                if (job.status == "error")
                {
                    failed++;
                }
                else if (job.status == "complete")
                {
                    completed++;
                }
                else if (!IsFinished(job.status))
                {
                    active++;
                }
            }

            if (failed > 0)
            {
                SetStatus(failed + " error(s)", Color.LightCoral);
            }
            else if (active > 0)
            {
                SetStatus(active + " download(s)...", Color.Khaki);
            }
            else if (completed > 0)
            {
                SetStatus("Downloads complete", Color.LightGreen);
            }
            else
            {
                SetStatus("Ready", Color.LightGreen);
            }
        }

        private void NotifyFinishedJobs(IEnumerable<Job> jobs)
        {
            foreach (Job job in jobs)
            {
                if (job.status != "complete" && job.status != "error")
                {
                    continue;
                }

                string key = job.id + ":" + job.status;

                if (notifications.ContainsKey(key))
                {
                    continue;
                }

                notifications[key] = true;
                notifyIcon.ShowBalloonTip(
                    job.status == "complete" ? 1800 : 2200,
                    AppName,
                    (job.label ?? "Media download") + (job.status == "complete" ? " completed." : " failed."),
                    job.status == "complete" ? ToolTipIcon.Info : ToolTipIcon.Error
                );
            }
        }

        private void SetStatus(string text, Color color)
        {
            statusLabel.Text = text;
            statusLabel.ForeColor = color;

            if (notifyIcon != null)
            {
                notifyIcon.Text = (AppName + " - " + text).Length > 63
                    ? AppName
                    : AppName + " - " + text;
            }
        }
    }

    internal static class Program
    {
        [STAThread]
        private static void Main()
        {
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            Application.Run(new HelperForm());
        }
    }
}
