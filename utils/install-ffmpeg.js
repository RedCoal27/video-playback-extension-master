const fs = require('fs');
const https = require('https');
const path = require('path');
const { spawnSync } = require('child_process');

const downloadUrl =
  'https://github.com/BtbN/FFmpeg-Builds/releases/latest/download/ffmpeg-master-latest-win64-gpl.zip';
const toolsDir = path.join(__dirname, '..', 'tools');
const zipPath = path.join(toolsDir, 'ffmpeg.zip');
const extractDir = path.join(toolsDir, 'ffmpeg-extract');
const destinationDir = path.join(toolsDir, 'ffmpeg');

const download = (url, target, redirectCount = 0) =>
  new Promise((resolve, reject) => {
    if (redirectCount > 5) {
      reject(new Error('Too many redirects while downloading ffmpeg.'));
      return;
    }

    https
      .get(url, (response) => {
        if (
          response.statusCode >= 300 &&
          response.statusCode < 400 &&
          response.headers.location
        ) {
          response.resume();
          download(response.headers.location, target, redirectCount + 1)
            .then(resolve)
            .catch(reject);
          return;
        }

        if (response.statusCode !== 200) {
          response.resume();
          reject(new Error(`Download failed with HTTP ${response.statusCode}.`));
          return;
        }

        fs.mkdirSync(path.dirname(target), { recursive: true });

        const file = fs.createWriteStream(target);

        response.pipe(file);
        file.on('finish', () => file.close(resolve));
        file.on('error', reject);
      })
      .on('error', reject);
  });

const findFile = (dir, filename) => {
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const entryPath = path.join(dir, entry.name);

    if (entry.isFile() && entry.name.toLowerCase() === filename) {
      return entryPath;
    }

    if (entry.isDirectory()) {
      const found = findFile(entryPath, filename);

      if (found) {
        return found;
      }
    }
  }

  return null;
};

const copyDirectory = (source, target) => {
  fs.mkdirSync(target, { recursive: true });

  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const sourcePath = path.join(source, entry.name);
    const targetPath = path.join(target, entry.name);

    if (entry.isDirectory()) {
      copyDirectory(sourcePath, targetPath);
    } else {
      fs.copyFileSync(sourcePath, targetPath);
    }
  }
};

const install = async () => {
  fs.mkdirSync(toolsDir, { recursive: true });
  await download(downloadUrl, zipPath);

  fs.rmSync(extractDir, { recursive: true, force: true });
  fs.mkdirSync(extractDir, { recursive: true });

  const expanded = spawnSync(
    'powershell',
    [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-Command',
      `Expand-Archive -LiteralPath '${zipPath.replace(/'/g, "''")}' -DestinationPath '${extractDir.replace(/'/g, "''")}' -Force`,
    ],
    { encoding: 'utf8', windowsHide: true }
  );

  if (expanded.status !== 0) {
    throw new Error(expanded.stderr || 'Failed to extract ffmpeg.');
  }

  const ffmpegExe = findFile(extractDir, 'ffmpeg.exe');

  if (!ffmpegExe) {
    throw new Error('ffmpeg.exe was not found in the downloaded archive.');
  }

  const packageRoot = path.dirname(path.dirname(ffmpegExe));

  fs.rmSync(destinationDir, { recursive: true, force: true });
  copyDirectory(packageRoot, destinationDir);
  fs.rmSync(extractDir, { recursive: true, force: true });
  fs.rmSync(zipPath, { force: true });

  console.log(`ffmpeg installed at ${path.join(destinationDir, 'bin', 'ffmpeg.exe')}`);
};

install().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
