Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$downloads = [Environment]::GetFolderPath('UserProfile') + '\Downloads'
$ytDlp = Join-Path $root 'tools\yt-dlp.exe'
$ffmpeg = Join-Path $root 'tools\ffmpeg\bin\ffmpeg.exe'
$aria2c = Join-Path $root 'tools\aria2\aria2c.exe'
$helperIconPath = Join-Path $root 'utils\helper-icon.ico'
$helperIcon = $null
$serverProcess = $null
$isClosing = $false
$jobNotifications = @{}
$createdNewInstance = $false
$singleInstanceMutex = New-Object System.Threading.Mutex($true, 'Global\VideoPlaybackHelperSingleInstance', [ref]$createdNewInstance)

if (-not $createdNewInstance) {
  [System.Windows.Forms.MessageBox]::Show(
    "Video Playback Helper is already running.",
    "Video Playback Helper",
    [System.Windows.Forms.MessageBoxButtons]::OK,
    [System.Windows.Forms.MessageBoxIcon]::Information
  ) | Out-Null
  return
}

if (Test-Path $helperIconPath) {
  $helperIcon = New-Object System.Drawing.Icon($helperIconPath)
}

function Set-Status {
  param(
    [string]$Text,
    [System.Drawing.Color]$Color = [System.Drawing.Color]::White
  )

  $statusLabel.Text = $Text
  $statusLabel.ForeColor = $Color
  $notifyIcon.Text = "Video Playback Helper - $Text"
}

function Test-Node {
  return [bool](Get-Command node -ErrorAction SilentlyContinue)
}

function Run-NodeScript {
  param([string]$Script)

  $process = Start-Process `
    -FilePath 'node' `
    -ArgumentList "`"$Script`"" `
    -WorkingDirectory $root `
    -WindowStyle Hidden `
    -Wait `
    -PassThru

  return $process.ExitCode -eq 0
}

function Ensure-Tools {
  if (-not (Test-Node)) {
    [System.Windows.Forms.MessageBox]::Show(
      "Node.js was not found. Install Node.js, then restart this helper.",
      "Video Playback Helper",
      [System.Windows.Forms.MessageBoxButtons]::OK,
      [System.Windows.Forms.MessageBoxIcon]::Error
    ) | Out-Null
    return $false
  }

  if (-not (Test-Path $ytDlp)) {
    Set-Status "Installing yt-dlp..." ([System.Drawing.Color]::Khaki)
    if (-not (Run-NodeScript (Join-Path $root 'utils\install-ytdlp.js'))) {
      Set-Status "yt-dlp could not be installed" ([System.Drawing.Color]::LightCoral)
      return $false
    }
  }

  if (-not (Test-Path $ffmpeg)) {
    Set-Status "Installing ffmpeg..." ([System.Drawing.Color]::Khaki)
    if (-not (Run-NodeScript (Join-Path $root 'utils\install-ffmpeg.js'))) {
      Set-Status "ffmpeg could not be installed" ([System.Drawing.Color]::LightCoral)
      return $false
    }
  }

  if (-not (Test-Path $aria2c)) {
    Set-Status "Installing aria2c..." ([System.Drawing.Color]::Khaki)
    if (-not (Run-NodeScript (Join-Path $root 'utils\install-aria2.js'))) {
      Set-Status "aria2c unavailable, using standard mode" ([System.Drawing.Color]::Khaki)
    }
  }

  return $true
}

function Test-HelperAlive {
  try {
    $response = Invoke-RestMethod -Uri 'http://127.0.0.1:47829/health' -TimeoutSec 2
    return $response.ok -eq $true
  } catch {
    return $false
  }
}

function Get-Jobs {
  try {
    $response = Invoke-RestMethod -Uri 'http://127.0.0.1:47829/jobs' -TimeoutSec 2

    if ($response.ok -eq $true) {
      return @($response.jobs)
    }
  } catch {
    return @()
  }

  return @()
}

function Stop-SelectedJob {
  if (-not $jobsListView.SelectedItems -or $jobsListView.SelectedItems.Count -eq 0) {
    return
  }

  $jobId = [string]$jobsListView.SelectedItems[0].Tag
  $jobStatus = [string]$jobsListView.SelectedItems[0].SubItems[4].Text

  if (-not $jobId) {
    return
  }

  $isFinished = $jobStatus -eq 'complete' -or $jobStatus -eq 'error' -or $jobStatus -eq 'cancelled'
  $action = if ($isFinished) { 'delete' } else { 'stop' }

  try {
    Invoke-RestMethod -Uri "http://127.0.0.1:47829/jobs/$jobId/$action" -Method Delete -TimeoutSec 2 | Out-Null
    Update-DownloadStatus
  } catch {
    Set-Status "Action failed" ([System.Drawing.Color]::LightCoral)
  }
}

function Update-SelectedJobDetails {
  if (-not $jobsListView.SelectedItems -or $jobsListView.SelectedItems.Count -eq 0) {
    $jobDetailsTextBox.Text = ''
    $stopSelectedButton.Text = 'Stop DL'
    $stopSelectedButton.Enabled = $false
    return
  }

  $selected = $jobsListView.SelectedItems[0]
  $jobStatus = [string]$selected.SubItems[4].Text
  $isFinished = $jobStatus -eq 'complete' -or $jobStatus -eq 'error' -or $jobStatus -eq 'cancelled'

  $jobDetailsTextBox.Text = $selected.SubItems[3].Text
  $stopSelectedButton.Text = if ($isFinished) { 'Delete' } else { 'Stop DL' }
  $stopSelectedButton.Enabled = $true
}

function Update-DownloadStatus {
  if (-not (Test-HelperAlive)) {
    return
  }

  $jobs = Get-Jobs

  if (-not $jobs -or $jobs.Count -eq 0) {
    $jobsListView.Items.Clear()
    return
  }

  $selectedJobId = ''
  if ($jobsListView.SelectedItems -and $jobsListView.SelectedItems.Count -gt 0) {
    $selectedJobId = [string]$jobsListView.SelectedItems[0].Tag
  }

  $jobsListView.BeginUpdate()
  $jobsListView.Items.Clear()

  foreach ($job in $jobs) {
    $percent = [Math]::Max(0, [Math]::Min(100, [int][Math]::Round([double]$job.percent)))
    $item = New-Object System.Windows.Forms.ListViewItem("$($job.label)")
    $item.Tag = "$($job.id)"
    $stateText = if ($job.speed) { "$($job.speed)" } else { "$($job.status)" }
    $item.SubItems.Add("$percent%") | Out-Null
    $item.SubItems.Add($stateText) | Out-Null
    $item.SubItems.Add("$($job.message)") | Out-Null
    $item.SubItems.Add("$($job.status)") | Out-Null
    $jobsListView.Items.Add($item) | Out-Null

    if ($selectedJobId -and $selectedJobId -eq "$($job.id)") {
      $item.Selected = $true
    }
  }

  $jobsListView.EndUpdate()

  Update-SelectedJobDetails

  $activeJobs = @($jobs | Where-Object { $_.status -ne 'complete' -and $_.status -ne 'error' -and $_.status -ne 'cancelled' })
  $failedJobs = @($jobs | Where-Object { $_.status -eq 'error' })
  $completedJobs = @($jobs | Where-Object { $_.status -eq 'complete' })

  if ($failedJobs.Count -gt 0) {
    Set-Status "$($failedJobs.Count) error(s)" ([System.Drawing.Color]::LightCoral)
  } elseif ($activeJobs.Count -gt 0) {
    Set-Status "$($activeJobs.Count) download(s)..." ([System.Drawing.Color]::Khaki)
  } elseif ($completedJobs.Count -gt 0) {
    Set-Status "Downloads complete" ([System.Drawing.Color]::LightGreen)
  } else {
    Set-Status "Ready" ([System.Drawing.Color]::LightGreen)
  }

  foreach ($job in $jobs) {
    if ($job.status -eq 'complete') {
      $notificationKey = "$($job.id):complete"

      if (-not $script:jobNotifications.ContainsKey($notificationKey)) {
        $script:jobNotifications[$notificationKey] = $true
        $notifyIcon.ShowBalloonTip(
          1800,
          'Video Playback Helper',
          "$($job.label) completed.",
          [System.Windows.Forms.ToolTipIcon]::Info
        )
      }
    } elseif ($job.status -eq 'error') {
      $notificationKey = "$($job.id):error"

      if (-not $script:jobNotifications.ContainsKey($notificationKey)) {
        $script:jobNotifications[$notificationKey] = $true
        $notifyIcon.ShowBalloonTip(
          2200,
          'Video Playback Helper',
          "$($job.label) failed.",
          [System.Windows.Forms.ToolTipIcon]::Error
        )
      }
    }
  }
}

function Start-Helper {
  if (Test-HelperAlive) {
    Set-Status "Ready" ([System.Drawing.Color]::LightGreen)
    return
  }

  if (-not (Ensure-Tools)) {
    return
  }

  Set-Status "Starting..." ([System.Drawing.Color]::Khaki)

  $script = Join-Path $root 'utils\ytdlp-server.js'
  $startInfo = New-Object System.Diagnostics.ProcessStartInfo
  $startInfo.FileName = 'node'
  $startInfo.Arguments = "`"$script`""
  $startInfo.WorkingDirectory = $root
  $startInfo.UseShellExecute = $false
  $startInfo.CreateNoWindow = $true

  $script:serverProcess = [System.Diagnostics.Process]::Start($startInfo)
  Start-Sleep -Milliseconds 800

  if (Test-HelperAlive) {
    Set-Status "Ready" ([System.Drawing.Color]::LightGreen)
  } else {
    Set-Status "Startup error" ([System.Drawing.Color]::LightCoral)
  }
}

function Stop-Helper {
  if ($script:serverProcess -and -not $script:serverProcess.HasExited) {
    $script:serverProcess.Kill()
    $script:serverProcess.Dispose()
  } elseif (Test-HelperAlive) {
    $connection = Get-NetTCPConnection -LocalAddress '127.0.0.1' -LocalPort 47829 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1

    if ($connection -and $connection.OwningProcess) {
      Stop-Process -Id $connection.OwningProcess -Force -ErrorAction SilentlyContinue
    }
  }

  $script:serverProcess = $null
  Set-Status "Stopped" ([System.Drawing.Color]::Gainsboro)
}

function Place-BottomRight {
  $screen = [System.Windows.Forms.Screen]::PrimaryScreen.WorkingArea
  $form.Location = New-Object System.Drawing.Point(
    ($screen.Right - $form.Width - 16),
    ($screen.Bottom - $form.Height - 16)
  )
}

$form = New-Object System.Windows.Forms.Form
$form.Text = 'Video Playback Helper'
$form.Width = 620
$form.Height = 430
$form.FormBorderStyle = [System.Windows.Forms.FormBorderStyle]::FixedSingle
$form.MaximizeBox = $false
$form.StartPosition = [System.Windows.Forms.FormStartPosition]::Manual
$form.BackColor = [System.Drawing.Color]::FromArgb(35, 39, 48)
$form.ForeColor = [System.Drawing.Color]::White
$form.Font = New-Object System.Drawing.Font('Segoe UI', 9)
if ($helperIcon) {
  $form.Icon = $helperIcon
}

$titleLabel = New-Object System.Windows.Forms.Label
$titleLabel.Text = 'Video Playback Helper'
$titleLabel.Font = New-Object System.Drawing.Font('Segoe UI', 11, [System.Drawing.FontStyle]::Bold)
$titleLabel.AutoSize = $true
$titleLabel.Location = New-Object System.Drawing.Point(16, 14)
$form.Controls.Add($titleLabel)

$statusLabel = New-Object System.Windows.Forms.Label
$statusLabel.Text = 'Initializing...'
$statusLabel.AutoSize = $true
$statusLabel.Location = New-Object System.Drawing.Point(18, 48)
$form.Controls.Add($statusLabel)

$stopSelectedButton = New-Object System.Windows.Forms.Button
$stopSelectedButton.Text = 'Stop DL'
$stopSelectedButton.Width = 82
$stopSelectedButton.Height = 28
$stopSelectedButton.Location = New-Object System.Drawing.Point(18, 86)
$stopSelectedButton.Enabled = $false
$stopSelectedButton.Add_Click({ Stop-SelectedJob })
$form.Controls.Add($stopSelectedButton)

$downloadsButton = New-Object System.Windows.Forms.Button
$downloadsButton.Text = 'Downloads'
$downloadsButton.Width = 82
$downloadsButton.Height = 28
$downloadsButton.Location = New-Object System.Drawing.Point(108, 86)
$downloadsButton.Add_Click({ Start-Process $downloads })
$form.Controls.Add($downloadsButton)

$hintLabel = New-Object System.Windows.Forms.Label
$hintLabel.Text = 'Minimize to keep the helper in the bottom-right corner.'
$hintLabel.AutoSize = $true
$hintLabel.ForeColor = [System.Drawing.Color]::Silver
$hintLabel.Location = New-Object System.Drawing.Point(18, 122)
$form.Controls.Add($hintLabel)

$jobsListView = New-Object System.Windows.Forms.ListView
$jobsListView.View = [System.Windows.Forms.View]::Details
$jobsListView.FullRowSelect = $true
$jobsListView.GridLines = $false
$jobsListView.Width = 574
$jobsListView.Height = 150
$jobsListView.Location = New-Object System.Drawing.Point(18, 148)
$jobsListView.BackColor = [System.Drawing.Color]::FromArgb(28, 31, 38)
$jobsListView.ForeColor = [System.Drawing.Color]::White
$jobsListView.Columns.Add('Download', 190) | Out-Null
$jobsListView.Columns.Add('%', 48) | Out-Null
$jobsListView.Columns.Add('Speed', 82) | Out-Null
$jobsListView.Columns.Add('Message', 248) | Out-Null
$jobsListView.Columns.Add('Status', 0) | Out-Null
$jobsListView.Add_SelectedIndexChanged({ Update-SelectedJobDetails })
$form.Controls.Add($jobsListView)

$jobDetailsTextBox = New-Object System.Windows.Forms.TextBox
$jobDetailsTextBox.Multiline = $true
$jobDetailsTextBox.ReadOnly = $true
$jobDetailsTextBox.ScrollBars = [System.Windows.Forms.ScrollBars]::Vertical
$jobDetailsTextBox.Width = 574
$jobDetailsTextBox.Height = 64
$jobDetailsTextBox.Location = New-Object System.Drawing.Point(18, 306)
$jobDetailsTextBox.BackColor = [System.Drawing.Color]::FromArgb(28, 31, 38)
$jobDetailsTextBox.ForeColor = [System.Drawing.Color]::White
$form.Controls.Add($jobDetailsTextBox)

$contextMenu = New-Object System.Windows.Forms.ContextMenuStrip
$showItem = $contextMenu.Items.Add('Show')
$showItem.Add_Click({
  $form.Show()
  $form.WindowState = [System.Windows.Forms.FormWindowState]::Normal
  Place-BottomRight
})
$openDownloadsItem = $contextMenu.Items.Add('Open downloads')
$openDownloadsItem.Add_Click({ Start-Process $downloads })
$contextMenu.Items.Add('-') | Out-Null
$exitItem = $contextMenu.Items.Add('Exit')
$exitItem.Add_Click({
  $script:isClosing = $true
  Stop-Helper
  $notifyIcon.Visible = $false
  $form.Close()
})

$notifyIcon = New-Object System.Windows.Forms.NotifyIcon
$notifyIcon.Icon = if ($helperIcon) { $helperIcon } else { [System.Drawing.SystemIcons]::Application }
$notifyIcon.Visible = $true
$notifyIcon.Text = 'Video Playback Helper'
$notifyIcon.ContextMenuStrip = $contextMenu
$notifyIcon.Add_DoubleClick({
  $form.Show()
  $form.WindowState = [System.Windows.Forms.FormWindowState]::Normal
  Place-BottomRight
})

$form.Add_Load({
  Place-BottomRight
  Start-Helper
})

$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 1000
$timer.Add_Tick({ Update-DownloadStatus })
$timer.Start()

$form.Add_Resize({
  if ($form.WindowState -eq [System.Windows.Forms.FormWindowState]::Minimized) {
    $form.Hide()
    $notifyIcon.ShowBalloonTip(
      1200,
      'Video Playback Helper',
      'The helper is still running in the background.',
      [System.Windows.Forms.ToolTipIcon]::Info
    )
  }
})

$form.Add_FormClosing({
  if (-not $script:isClosing) {
    $_.Cancel = $true
    $form.WindowState = [System.Windows.Forms.FormWindowState]::Minimized
  }
})

$form.Add_FormClosed({
  $timer.Stop()
  $timer.Dispose()
  if ($script:singleInstanceMutex) {
    $script:singleInstanceMutex.ReleaseMutex()
    $script:singleInstanceMutex.Dispose()
  }
  if ($script:helperIcon) {
    $script:helperIcon.Dispose()
  }
})

[System.Windows.Forms.Application]::EnableVisualStyles()
[System.Windows.Forms.Application]::Run($form)
