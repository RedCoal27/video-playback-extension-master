# Video Playback + Volume + Download

A Chrome/Brave extension for controlling HTML5 video playback, boosting volume, and downloading online media through a small Windows companion app.

This project is based on the original [Video Playback Extension](https://github.com/sunnyw1212/video-playback-extension). The goal of this fork is to keep the simple media-control popup while adding practical tools for daily video use: persistent playback settings, volume boost, clearer speed controls, and download support for regular HTML5 videos and yt-dlp compatible sites.

<img width="295" height="530" alt="extension image" src="https://github.com/user-attachments/assets/6f3bced8-cd1c-4be0-bb9f-f32569ef2010" />

<img width="603" height="416" alt="image" src="https://github.com/user-attachments/assets/ffc45228-1ad8-486f-aa74-6e0e5f7840c4" />


## Features

- Control playback speed from a simple slider.
- Boost video and audio volume above 100%.
- Apply controls to the current tab or all open tabs.
- Keep the last configured settings for future videos.
- Play, pause, restart, loop, skip, and use theater mode.
- Customize keyboard shortcuts.
- Detect downloadable media from the current page.
- Preview available download formats and qualities before downloading.
- Download simple HTML5 media directly through the browser.
- Use a Windows companion app for more advanced downloads, including streams and yt-dlp supported sites.
- Follow active downloads from the popup or the companion app.
- Queue multiple downloads in parallel.

## Companion App

Some sites do not expose a direct file that Chrome can download cleanly. For those cases, the extension can talk to a local Windows companion app.

The companion handles media inspection and advanced downloads using:

- [yt-dlp](https://github.com/yt-dlp/yt-dlp)
- [FFmpeg](https://github.com/FFmpeg/FFmpeg)
- [aria2](https://github.com/aria2/aria2)

The companion runs locally on:

```text
http://127.0.0.1:47829
```

## Installation

Install dependencies and local tools:

```powershell
npm install
npm run install:ytdlp
npm run install:ffmpeg
npm run install:aria2
npm run build
```

Load the extension:

1. Open `chrome://extensions/`.
2. Enable `Developer mode`.
3. Click `Load unpacked`.
4. Select the `build` folder.

Start the companion by launching:

```text
Video Playback Helper.exe
```

If the executable is not available, use:

```text
Video Playback Helper.vbs
```

## Usage

Open a page with a video, click the extension icon, then adjust playback speed, volume, loop, theater mode, or download options.

For downloads, click `Download Media`. The popup will show direct media choices when possible, or ask the companion to inspect the page and return available formats.

## Development

Build the extension locally:

```powershell
npm run build
```

Build the helper executable:

```powershell
npm run build:helper
```

Create local release assets:

```powershell
npm run package:release
```

This creates:

- `dist/release/video-playback-extension.crx`
- `dist/release/Video Playback Helper.exe`
- standalone helper scripts in `dist/release`

## GitHub Releases

Pushing a tag named `v*`, for example `v3.2.0`, automatically builds and publishes a GitHub release with:

- the packed Chrome/Brave extension
- the standalone Windows helper executable
- standalone helper scripts

You can also run the `Release` workflow manually from GitHub Actions and provide the target tag.

Build the extension:

```powershell
npm run build
```

Run the development server:

```powershell
npm start
```

Run only the companion server:

```powershell
npm run ytdlp-server
```

Install or update local tools:

```powershell
npm run install:ytdlp
npm run install:ffmpeg
npm run install:aria2
```

Build the Windows helper launcher:

```powershell
powershell -ExecutionPolicy Bypass -File utils/build-helper-exe.ps1
```

Force-stop companion-related background processes:

```powershell
Get-Process node,aria2c,yt-dlp,ffmpeg -ErrorAction SilentlyContinue | Stop-Process -Force
```

## Project Structure

- `src/pages/Popup`: extension popup UI.
- `src/pages/Content`: page media detection and playback control.
- `src/pages/Background`: Chrome background actions.
- `utils/ytdlp-server.js`: local download server used by the companion.
- `utils/helper-ui.ps1`: Windows companion interface.
- `tools`: local yt-dlp, FFmpeg, and aria2 binaries.
- `build`: compiled extension loaded into Chrome/Brave.

## Credits

Original project:

- [sunnyw1212/video-playback-extension](https://github.com/sunnyw1212/video-playback-extension)
- [Video Playback Extension on the Chrome Web Store](https://chromewebstore.google.com/detail/video-playback-extension/dilncfnkialpgbnpcjmghnepnankdibk)
- [chrome-extension-boilerplate-react](https://github.com/lxieyang/chrome-extension-boilerplate-react)

Fork direction, testing, and feature requests by **RedCoal**.

Implementation assistance by **OpenAI Codex**.

## Limitations

- DRM-protected media is not supported.
- Some sites block downloads or frequently change how their media works.
- Platform support depends partly on yt-dlp compatibility.

## License

MIT.

Original Video Playback Extension copyright (c) 2021 Sunny Wong.
