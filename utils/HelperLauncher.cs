using System;
using System.Diagnostics;
using System.IO;
using System.Windows.Forms;

namespace VideoPlaybackHelperLauncher
{
    internal static class Program
    {
        [STAThread]
        private static void Main()
        {
            string root = AppDomain.CurrentDomain.BaseDirectory;
            string scriptPath = Path.Combine(root, "utils", "helper-ui.ps1");

            if (!File.Exists(scriptPath))
            {
                MessageBox.Show(
                    "Unable to find utils\\helper-ui.ps1 next to the launcher.",
                    "Video Playback Helper",
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Error
                );
                return;
            }

            var startInfo = new ProcessStartInfo
            {
                FileName = "powershell.exe",
                Arguments = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -STA -File \"" + scriptPath + "\"",
                WorkingDirectory = root,
                UseShellExecute = false,
                CreateNoWindow = true,
                WindowStyle = ProcessWindowStyle.Hidden,
            };

            try
            {
                Process.Start(startInfo);
            }
            catch (Exception error)
            {
                MessageBox.Show(
                    error.Message,
                    "Video Playback Helper",
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Error
                );
            }
        }
    }
}
