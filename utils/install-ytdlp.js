const fs = require('fs');
const https = require('https');
const path = require('path');

const downloadUrl =
  'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe';
const toolsDir = path.join(__dirname, '..', 'tools');
const destination = path.join(toolsDir, 'yt-dlp.exe');

const download = (url, target, redirectCount = 0) =>
  new Promise((resolve, reject) => {
    if (redirectCount > 5) {
      reject(new Error('Too many redirects while downloading yt-dlp.'));
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
        file.on('finish', () => {
          file.close(resolve);
        });
        file.on('error', reject);
      })
      .on('error', reject);
  });

download(downloadUrl, destination)
  .then(() => {
    console.log(`yt-dlp installed at ${destination}`);
  })
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
