Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$downloads = [Environment]::GetFolderPath('UserProfile') + '\Downloads'
$ytDlp = Join-Path $root 'tools\yt-dlp.exe'
$ffmpeg = Join-Path $root 'tools\ffmpeg\bin\ffmpeg.exe'
$serverProcess = $null
$isClosing = $false
$lastJobNotification = ''

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
      "Node.js est introuvable. Installe Node.js puis relance ce helper.",
      "Video Playback Helper",
      [System.Windows.Forms.MessageBoxButtons]::OK,
      [System.Windows.Forms.MessageBoxIcon]::Error
    ) | Out-Null
    return $false
  }

  if (-not (Test-Path $ytDlp)) {
    Set-Status "Installation de yt-dlp..." ([System.Drawing.Color]::Khaki)
    if (-not (Run-NodeScript (Join-Path $root 'utils\install-ytdlp.js'))) {
      Set-Status "yt-dlp n'a pas pu etre installe" ([System.Drawing.Color]::LightCoral)
      return $false
    }
  }

  if (-not (Test-Path $ffmpeg)) {
    Set-Status "Installation de ffmpeg..." ([System.Drawing.Color]::Khaki)
    if (-not (Run-NodeScript (Join-Path $root 'utils\install-ffmpeg.js'))) {
      Set-Status "ffmpeg n'a pas pu etre installe" ([System.Drawing.Color]::LightCoral)
      return $false
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

function Get-LatestJob {
  try {
    $response = Invoke-RestMethod -Uri 'http://127.0.0.1:47829/jobs/latest' -TimeoutSec 2

    if ($response.ok -eq $true) {
      return $response.job
    }
  } catch {
    return $null
  }

  return $null
}

function Update-DownloadStatus {
  if (-not (Test-HelperAlive)) {
    return
  }

  $job = Get-LatestJob

  if (-not $job) {
    return
  }

  $percent = [Math]::Max(0, [Math]::Min(100, [int][Math]::Round([double]$job.percent)))
  $progressBar.Value = $percent
  $jobLabel.Text = "$($job.label) - $percent%"
  $jobMessageLabel.Text = $job.message

  if ($job.status -eq 'complete') {
    Set-Status "Telechargement termine" ([System.Drawing.Color]::LightGreen)
    $notificationKey = "$($job.id):complete"

    if ($script:lastJobNotification -ne $notificationKey) {
      $script:lastJobNotification = $notificationKey
      $notifyIcon.ShowBalloonTip(
        1800,
        'Video Playback Helper',
        'Telechargement termine.',
        [System.Windows.Forms.ToolTipIcon]::Info
      )
    }
  } elseif ($job.status -eq 'error') {
    Set-Status "Erreur de telechargement" ([System.Drawing.Color]::LightCoral)
    $notificationKey = "$($job.id):error"

    if ($script:lastJobNotification -ne $notificationKey) {
      $script:lastJobNotification = $notificationKey
      $notifyIcon.ShowBalloonTip(
        2200,
        'Video Playback Helper',
        'Le telechargement a echoue.',
        [System.Windows.Forms.ToolTipIcon]::Error
      )
    }
  } elseif ($job.status -eq 'processing') {
    Set-Status "Assemblage video..." ([System.Drawing.Color]::Khaki)
  } else {
    Set-Status "Telechargement..." ([System.Drawing.Color]::Khaki)
  }
}

function Start-Helper {
  if (Test-HelperAlive) {
    Set-Status "Pret" ([System.Drawing.Color]::LightGreen)
    $startButton.Enabled = $false
    $stopButton.Enabled = $true
    return
  }

  if (-not (Ensure-Tools)) {
    $startButton.Enabled = $true
    $stopButton.Enabled = $false
    return
  }

  Set-Status "Demarrage..." ([System.Drawing.Color]::Khaki)

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
    Set-Status "Pret" ([System.Drawing.Color]::LightGreen)
    $startButton.Enabled = $false
    $stopButton.Enabled = $true
  } else {
    Set-Status "Erreur au demarrage" ([System.Drawing.Color]::LightCoral)
    $startButton.Enabled = $true
    $stopButton.Enabled = $false
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
  Set-Status "Arrete" ([System.Drawing.Color]::Gainsboro)
  $startButton.Enabled = $true
  $stopButton.Enabled = $false
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
$form.Width = 310
$form.Height = 230
$form.FormBorderStyle = [System.Windows.Forms.FormBorderStyle]::FixedSingle
$form.MaximizeBox = $false
$form.StartPosition = [System.Windows.Forms.FormStartPosition]::Manual
$form.BackColor = [System.Drawing.Color]::FromArgb(35, 39, 48)
$form.ForeColor = [System.Drawing.Color]::White
$form.Font = New-Object System.Drawing.Font('Segoe UI', 9)

$titleLabel = New-Object System.Windows.Forms.Label
$titleLabel.Text = 'Video Playback Helper'
$titleLabel.Font = New-Object System.Drawing.Font('Segoe UI', 11, [System.Drawing.FontStyle]::Bold)
$titleLabel.AutoSize = $true
$titleLabel.Location = New-Object System.Drawing.Point(16, 14)
$form.Controls.Add($titleLabel)

$statusLabel = New-Object System.Windows.Forms.Label
$statusLabel.Text = 'Initialisation...'
$statusLabel.AutoSize = $true
$statusLabel.Location = New-Object System.Drawing.Point(18, 48)
$form.Controls.Add($statusLabel)

$startButton = New-Object System.Windows.Forms.Button
$startButton.Text = 'Demarrer'
$startButton.Width = 82
$startButton.Height = 28
$startButton.Location = New-Object System.Drawing.Point(18, 86)
$startButton.Add_Click({ Start-Helper })
$form.Controls.Add($startButton)

$stopButton = New-Object System.Windows.Forms.Button
$stopButton.Text = 'Arreter'
$stopButton.Width = 82
$stopButton.Height = 28
$stopButton.Location = New-Object System.Drawing.Point(108, 86)
$stopButton.Enabled = $false
$stopButton.Add_Click({ Stop-Helper })
$form.Controls.Add($stopButton)

$downloadsButton = New-Object System.Windows.Forms.Button
$downloadsButton.Text = 'Downloads'
$downloadsButton.Width = 82
$downloadsButton.Height = 28
$downloadsButton.Location = New-Object System.Drawing.Point(198, 86)
$downloadsButton.Add_Click({ Start-Process $downloads })
$form.Controls.Add($downloadsButton)

$hintLabel = New-Object System.Windows.Forms.Label
$hintLabel.Text = 'Reduire pour garder le helper en bas a droite.'
$hintLabel.AutoSize = $true
$hintLabel.ForeColor = [System.Drawing.Color]::Silver
$hintLabel.Location = New-Object System.Drawing.Point(18, 122)
$form.Controls.Add($hintLabel)

$jobLabel = New-Object System.Windows.Forms.Label
$jobLabel.Text = 'Aucun telechargement'
$jobLabel.AutoEllipsis = $true
$jobLabel.Width = 262
$jobLabel.Height = 18
$jobLabel.Location = New-Object System.Drawing.Point(18, 148)
$form.Controls.Add($jobLabel)

$progressBar = New-Object System.Windows.Forms.ProgressBar
$progressBar.Width = 262
$progressBar.Height = 10
$progressBar.Minimum = 0
$progressBar.Maximum = 100
$progressBar.Value = 0
$progressBar.Location = New-Object System.Drawing.Point(18, 170)
$form.Controls.Add($progressBar)

$jobMessageLabel = New-Object System.Windows.Forms.Label
$jobMessageLabel.Text = ''
$jobMessageLabel.AutoEllipsis = $true
$jobMessageLabel.Width = 262
$jobMessageLabel.Height = 18
$jobMessageLabel.ForeColor = [System.Drawing.Color]::Silver
$jobMessageLabel.Location = New-Object System.Drawing.Point(18, 186)
$form.Controls.Add($jobMessageLabel)

$contextMenu = New-Object System.Windows.Forms.ContextMenuStrip
$showItem = $contextMenu.Items.Add('Afficher')
$showItem.Add_Click({
  $form.Show()
  $form.WindowState = [System.Windows.Forms.FormWindowState]::Normal
  Place-BottomRight
})
$openDownloadsItem = $contextMenu.Items.Add('Ouvrir les telechargements')
$openDownloadsItem.Add_Click({ Start-Process $downloads })
$contextMenu.Items.Add('-') | Out-Null
$startItem = $contextMenu.Items.Add('Demarrer')
$startItem.Add_Click({ Start-Helper })
$stopItem = $contextMenu.Items.Add('Arreter')
$stopItem.Add_Click({ Stop-Helper })
$contextMenu.Items.Add('-') | Out-Null
$exitItem = $contextMenu.Items.Add('Quitter')
$exitItem.Add_Click({
  $script:isClosing = $true
  Stop-Helper
  $notifyIcon.Visible = $false
  $form.Close()
})

$notifyIcon = New-Object System.Windows.Forms.NotifyIcon
$notifyIcon.Icon = [System.Drawing.SystemIcons]::Application
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
      'Le helper continue en arriere-plan.',
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
})

[System.Windows.Forms.Application]::EnableVisualStyles()
[System.Windows.Forms.Application]::Run($form)
