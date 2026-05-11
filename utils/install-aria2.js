const fs = require('fs');
const https = require('https');
const path = require('path');
const { spawnSync } = require('child_process');

const apiUrl = 'https://api.github.com/repos/aria2/aria2/releases/latest';
const toolsDir = path.join(__dirname, '..', 'tools');
const zipPath = path.join(toolsDir, 'aria2.zip');
const extractDir = path.join(toolsDir, 'aria2-extract');
const destinationDir = path.join(toolsDir, 'aria2');

const requestText = (url, redirectCount = 0) =>
  new Promise((resolve, reject) => {
    if (redirectCount > 5) {
      reject(new Error('Too many redirects while downloading aria2.'));
      return;
    }

    https
      .get(
        url,
        {
          headers: {
            'User-Agent': 'video-playback-helper',
            Accept: 'application/vnd.github+json, */*',
          },
        },
        (response) => {
          if (
            response.statusCode >= 300 &&
            response.statusCode < 400 &&
            response.headers.location
          ) {
            response.resume();
            requestText(response.headers.location, redirectCount + 1)
              .then(resolve)
              .catch(reject);
            return;
          }

          if (response.statusCode !== 200) {
            response.resume();
            reject(new Error(`Request failed with HTTP ${response.statusCode}.`));
            return;
          }

          let body = '';

          response.on('data', (chunk) => {
            body += chunk;
          });
          response.on('end', () => resolve(body));
        }
      )
      .on('error', reject);
  });

const download = (url, target, redirectCount = 0) =>
  new Promise((resolve, reject) => {
    if (redirectCount > 5) {
      reject(new Error('Too many redirects while downloading aria2.'));
      return;
    }

    https
      .get(
        url,
        {
          headers: {
            'User-Agent': 'video-playback-helper',
            Accept: '*/*',
          },
        },
        (response) => {
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
        }
      )
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

const install = async () => {
  fs.mkdirSync(toolsDir, { recursive: true });

  const release = JSON.parse(await requestText(apiUrl));
  const asset = (release.assets || []).find((candidate) =>
    /win-64bit.*\.zip$/i.test(candidate.name)
  );

  if (!asset?.browser_download_url) {
    throw new Error('No Windows 64-bit aria2 release asset was found.');
  }

  await download(asset.browser_download_url, zipPath);

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
    throw new Error(expanded.stderr || 'Failed to extract aria2.');
  }

  const aria2c = findFile(extractDir, 'aria2c.exe');

  if (!aria2c) {
    throw new Error('aria2c.exe was not found in the downloaded archive.');
  }

  fs.rmSync(destinationDir, { recursive: true, force: true });
  fs.mkdirSync(destinationDir, { recursive: true });
  fs.copyFileSync(aria2c, path.join(destinationDir, 'aria2c.exe'));
  fs.rmSync(extractDir, { recursive: true, force: true });
  fs.rmSync(zipPath, { force: true });

  console.log(`aria2c installed at ${path.join(destinationDir, 'aria2c.exe')}`);
};

install().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
