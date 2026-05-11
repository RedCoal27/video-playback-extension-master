# Video Playback + Volume + Download

A Chrome/Brave extension for controlling HTML5 video playback, boosting volume, and downloading media through a small local Windows companion app.

This project is based on the original [Video Playback Extension](https://github.com/sunnyw1212/video-playback-extension). It keeps the original idea of a lightweight popup for media controls, then extends it with persistent settings, a volume booster, a more direct speed control, and companion-powered downloads for sites where browser downloads are not enough.

## Credits

Built from and inspired by:

- [sunnyw1212/video-playback-extension](https://github.com/sunnyw1212/video-playback-extension)
- [Video Playback Extension on the Chrome Web Store](https://chromewebstore.google.com/detail/video-playback-extension/dilncfnkialpgbnpcjmghnepnankdibk)
- [chrome-extension-boilerplate-react](https://github.com/lxieyang/chrome-extension-boilerplate-react)

The download companion uses local binaries from:

- [yt-dlp](https://github.com/yt-dlp/yt-dlp)
- [FFmpeg](https://github.com/FFmpeg/FFmpeg)
- [aria2](https://github.com/aria2/aria2)

## Features

- Control playback speed from the popup.
- Boost video/audio volume above 100%.
- Apply controls to the current tab or every open tab.
- Keep the last configured settings and reuse them on future videos.
- Play, pause, restart, loop, skip forward/backward, and theater mode.
- Configurable keyboard shortcuts.
- Detect downloadable HTML5 media and common streaming sources.
- Show available download formats/qualities before starting a download.
- Use a local companion app for advanced downloads, including streams and yt-dlp supported sites.
- Track download progress from both the popup and the companion app.
- Queue multiple downloads in the companion.

## How It Works

The browser extension handles playback controls directly inside web pages.

For downloads, simple media files can be passed to Chrome directly. More complex cases are sent to the local companion app, which runs on Windows and exposes a local server at:

```text
http://127.0.0.1:47829
```

The companion uses yt-dlp, FFmpeg, and aria2 to inspect media formats, download streams, merge audio/video when needed, and save the final file to the Windows Downloads folder.

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

Start the companion by double-clicking:

```text
Video Playback Helper.vbs
```

If that does not work, use:

```text
Video Playback Helper.cmd
```

## Usage

Open a page with a video, click the extension icon, then adjust playback speed, volume, loop, theater mode, or download options.

For downloads, click `Download Media`. The popup will either show direct media choices or ask the companion to inspect the page and return the available formats.

## Development

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

## Limitations

- DRM-protected media is not supported.
- Some sites block downloads or change their media system often.
- Stream progress can be approximate, especially for live or fragmented media.
- YouTube and other platforms depend on yt-dlp support.

## License

MIT.

Original Video Playback Extension copyright (c) 2021 Sunny Wong.
