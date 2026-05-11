const http = require('http');
const fs = require('fs');
const { spawn, spawnSync } = require('child_process');
const os = require('os');
const path = require('path');

const PORT = Number(process.env.YTDLP_SERVER_PORT || 47829);
const HOST = '127.0.0.1';
const DOWNLOAD_DIR = process.env.YTDLP_DOWNLOAD_DIR || path.join(os.homedir(), 'Downloads');
const LOCAL_YTDLP = path.join(__dirname, '..', 'tools', 'yt-dlp.exe');
const LOCAL_FFMPEG_DIR = path.join(__dirname, '..', 'tools', 'ffmpeg', 'bin');
const LOCAL_FFMPEG = path.join(LOCAL_FFMPEG_DIR, 'ffmpeg.exe');
const LOCAL_ARIA2C = path.join(__dirname, '..', 'tools', 'aria2', 'aria2c.exe');
const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36';
const YOUTUBE_AUDIO_LANGUAGE_CODES = [
  'af', 'az', 'id', 'ms', 'bs', 'ca', 'cs', 'da', 'de', 'et',
  'en-IN', 'en-GB', 'en', 'es', 'es-419', 'es-US', 'eu', 'fil',
  'fr', 'fr-CA', 'gl', 'hr', 'zu', 'is', 'it', 'sw', 'lv', 'lt',
  'hu', 'nl', 'no', 'uz', 'pl', 'pt-PT', 'pt', 'ro', 'sq', 'sk',
  'sl', 'sr-Latn', 'fi', 'sv', 'vi', 'tr', 'be', 'bg', 'ky', 'kk',
  'mk', 'mn', 'ru', 'sr', 'uk', 'el', 'hy', 'iw', 'ur', 'ar', 'fa',
  'ne', 'mr', 'hi', 'as', 'bn', 'pa', 'gu', 'or', 'ta', 'te', 'kn',
  'ml', 'si', 'th', 'lo', 'my', 'ka', 'am', 'km', 'zh-CN', 'zh-TW',
  'zh-HK', 'ja', 'ko',
];

let cachedYtDlp = null;
let latestJobId = null;
let nextJobId = 1;

const jobs = new Map();

const commandCandidates = [
  process.env.YTDLP_PATH ? { command: process.env.YTDLP_PATH, args: [] } : null,
  { command: LOCAL_YTDLP, args: [] },
  { command: 'yt-dlp', args: [] },
  { command: 'yt-dlp.exe', args: [] },
  { command: 'python', args: ['-m', 'yt_dlp'] },
  { command: 'python3', args: ['-m', 'yt_dlp'] },
].filter(Boolean);

const sendJson = (response, statusCode, payload) => {
  response.writeHead(statusCode, {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json; charset=utf-8',
  });
  response.end(JSON.stringify(payload));
};

const getRequestBody = (request) =>
  new Promise((resolve, reject) => {
    let body = '';

    request.on('data', (chunk) => {
      body += chunk;

      if (body.length > 1024 * 1024) {
        reject(new Error('Request body too large.'));
        request.destroy();
      }
    });
    request.on('end', () => resolve(body));
    request.on('error', reject);
  });

const findYtDlp = () => {
  if (cachedYtDlp) {
    return cachedYtDlp;
  }

  for (const candidate of commandCandidates) {
    const result = spawnSync(candidate.command, [...candidate.args, '--version'], {
      encoding: 'utf8',
      windowsHide: true,
    });

    if (result.status === 0) {
      cachedYtDlp = candidate;
      return cachedYtDlp;
    }
  }

  throw new Error(
    'yt-dlp is not installed. Run npm run install:ytdlp, then restart npm run ytdlp-server.'
  );
};

const runYtDlp = (args, timeoutMs = 0) =>
  new Promise((resolve, reject) => {
    let candidate;

    try {
      candidate = findYtDlp();
    } catch (error) {
      reject(error);
      return;
    }

    const child = spawn(candidate.command, [...candidate.args, ...args], {
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    let timeoutId = null;
    let didTimeOut = false;

    if (timeoutMs > 0) {
      timeoutId = setTimeout(() => {
        didTimeOut = true;
        child.kill('SIGKILL');
      }, timeoutMs);
    }

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }

      if (didTimeOut) {
        reject(new Error('yt-dlp format detection timed out.'));
        return;
      }

      if (code === 0) {
        resolve(stdout);
        return;
      }

      reject(new Error(stderr.trim() || `yt-dlp exited with code ${code}.`));
    });
  });

const createJob = (label) => {
  const id = String(nextJobId++);
  const job = {
    id,
    label,
    status: 'starting',
    percent: 0,
    speed: '',
    message: 'Starting download...',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  jobs.set(id, job);
  latestJobId = id;

  return job;
};

const updateJob = (job, patch) => {
  Object.assign(job, patch, {
    updatedAt: new Date().toISOString(),
  });
};

const isRetryableServerError = (message) =>
  /HTTP Error (429|500|502|503|504)|Service Temporarily Unavailable/i.test(
    message || ''
  );

const killProcessTree = (pid) => {
  if (!pid) {
    return;
  }

  spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], {
    windowsHide: true,
    stdio: 'ignore',
  });
};

const killAria2cProcesses = () => {
  spawnSync('taskkill', ['/IM', 'aria2c.exe', '/T', '/F'], {
    windowsHide: true,
    stdio: 'ignore',
  });
};

const parseYtDlpLine = (line) => {
  const normalizedLine = line.replace(/\s+/g, ' ').trim();

  if (/^-{8,}$/.test(normalizedLine)) {
    return null;
  }

  const percentMatch = line.match(/\[download\]\s+(\d+(?:\.\d+)?)%/);
  const speedMatch = line.match(/\bat\s+([^\s]+\/s)/i);
  const aria2SpeedMatch = line.match(/\bDL:([^\]\s]+)/i);
  const aria2SizeMatch = line.match(/\((\d+)%\)/);
  const destinationMatch = normalizedLine.match(
    /\[(?:download|Merger)\]\s+(?:Destination:|Merging formats into)\s+"?(.+?)"?$/
  );

  if (destinationMatch) {
    return {
      label: path.basename(destinationMatch[1]),
      message: normalizedLine,
    };
  }

  if (percentMatch) {
    return {
      status: 'downloading',
      percent: Number(percentMatch[1]),
      speed: speedMatch ? speedMatch[1] : '',
      message: normalizedLine,
    };
  }

  if (aria2SpeedMatch || aria2SizeMatch) {
    return {
      status: 'downloading',
      ...(aria2SizeMatch ? { percent: Number(aria2SizeMatch[1]) } : {}),
      speed: aria2SpeedMatch ? aria2SpeedMatch[1] : '',
      message: normalizedLine,
    };
  }

  if (line.includes('[Merger]') || line.includes('[ffmpeg]')) {
    return {
      status: 'processing',
      percent: 100,
      speed: '',
      message: normalizedLine,
    };
  }

  if (line.includes('has already been downloaded')) {
    return {
      status: 'complete',
      percent: 100,
      speed: '',
      message: 'Already downloaded.',
    };
  }

  return {
    message: normalizedLine,
  };
};

const startYtDlp = (args, job, fallbackArgs = null, retryCount = 0) => {
  const candidate = findYtDlp();
  const child = spawn(candidate.command, [...candidate.args, ...args], {
    windowsHide: true,
  });
  let stdoutBuffer = '';
  let stderrBuffer = '';

  job.process = child;

  const handleOutput = (chunk, stream) => {
    const text = chunk.toString();
    const buffer = stream === 'stdout' ? stdoutBuffer + text : stderrBuffer + text;
    const lines = buffer.split(/\r?\n/);
    const rest = lines.pop() || '';

    if (stream === 'stdout') {
      stdoutBuffer = rest;
    } else {
      stderrBuffer = rest;
    }

    lines.forEach((line) => {
      const trimmed = line.trim();

      if (!trimmed) {
        return;
      }

      const patch = parseYtDlpLine(trimmed);

      if (patch) {
        updateJob(job, patch);
      }
    });
  };

  updateJob(job, {
    status: 'running',
    message: 'Download running...',
  });

  child.stdout.on('data', (chunk) => handleOutput(chunk, 'stdout'));
  child.stderr.on('data', (chunk) => handleOutput(chunk, 'stderr'));
  child.on('close', (code) => {
    if (job.process === child) {
      job.process = null;
    }

    if (job.status === 'cancelled') {
      return;
    }

    if (code !== 0 && fallbackArgs) {
      killProcessTree(child.pid);
      killAria2cProcesses();
      cleanupAria2Artifacts(job);
      updateJob(job, {
        status: 'running',
        percent: 0,
        message: 'Mode rapide refuse, nettoyage puis tentative en mode standard...',
      });
      startYtDlp(fallbackArgs, job);
      return;
    }

    if (code !== 0 && isRetryableServerError(job.message) && retryCount < 3) {
      const delaySeconds = 10 * (retryCount + 1);

      updateJob(job, {
        status: 'waiting',
        speed: '',
        message: `Serveur temporairement indisponible. Nouvelle tentative dans ${delaySeconds}s...`,
      });

      setTimeout(() => {
        if (job.status === 'cancelled' || job.status === 'deleted') {
          return;
        }

        startYtDlp(args, job, null, retryCount + 1);
      }, delaySeconds * 1000);
      return;
    }

    updateJob(
      job,
      code === 0
        ? {
            status: 'complete',
            percent: 100,
            speed: '',
            message: 'Download complete.',
          }
        : {
            status: 'error',
            speed: '',
            message: job.message || `yt-dlp download failed with code ${code}.`,
          }
    );
  });

  return child;
};

const getPublicJob = (job) => {
  const { process, ...publicJob } = job;

  return publicJob;
};

const cleanupAria2Artifacts = (job) => {
  const cutoff = new Date(job.createdAt).getTime() - 5000;

  try {
    for (const filename of fs.readdirSync(DOWNLOAD_DIR)) {
      if (!filename.endsWith('.aria2')) {
        continue;
      }

      const artifactPath = path.join(DOWNLOAD_DIR, filename);
      const stat = fs.statSync(artifactPath);

      if (stat.mtimeMs < cutoff) {
        continue;
      }

      fs.rmSync(artifactPath, { force: true });

      const partialPath = artifactPath.slice(0, -'.aria2'.length);

      if (fsExists(partialPath)) {
        const partialStat = fs.statSync(partialPath);

        if (partialStat.mtimeMs >= cutoff) {
          fs.rmSync(partialPath, { force: true });
        }
      }
    }
  } catch (error) {
    updateJob(job, {
      message: 'Mode rapide refuse, nettoyage partiel impossible.',
    });
  }
};

const cleanupStaleAria2ControlFiles = () => {
  try {
    for (const filename of fs.readdirSync(DOWNLOAD_DIR)) {
      if (filename.endsWith('.aria2')) {
        fs.rmSync(path.join(DOWNLOAD_DIR, filename), { force: true });
      }
    }
  } catch (error) {
    // Best-effort cleanup only.
  }
};

const stopJob = (job) => {
  if (job.process && !job.process.killed) {
    killProcessTree(job.process.pid);
  }

  killAria2cProcesses();
  cleanupAria2Artifacts(job);

  updateJob(job, {
    status: 'cancelled',
    speed: '',
    message: 'Download stopped manually.',
  });
};

const deleteJob = (jobId) => {
  const job = jobs.get(jobId);

  if (!job) {
    return false;
  }

  if (job.process && !job.process.killed) {
    killProcessTree(job.process.pid);
  }

  killAria2cProcesses();
  cleanupAria2Artifacts(job);

  updateJob(job, {
    status: 'deleted',
    speed: '',
    message: 'Deleted from list.',
  });
  jobs.delete(jobId);
  return true;
};

const fsExists = (filePath) => {
  try {
    fs.accessSync(filePath);
    return true;
  } catch (error) {
    return false;
  }
};

const findAria2c = () => {
  if (fsExists(LOCAL_ARIA2C)) {
    return LOCAL_ARIA2C;
  }

  const result = spawnSync('aria2c', ['--version'], {
    encoding: 'utf8',
    windowsHide: true,
  });

  return result.status === 0 ? 'aria2c' : '';
};

const sanitizeText = (value) =>
  String(value || '')
    .replace(/[\\/:*?"<>|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const sanitizeFilename = (value) =>
  String(value || '')
    .replace(/[\\/:*?"<>|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const formatBytes = (value) => {
  if (!value) {
    return '';
  }

  const mb = value / (1024 * 1024);

  return `${mb.toFixed(mb >= 100 ? 0 : 1)} MB`;
};

const formatDetail = (parts) => parts.filter(Boolean).join(' - ');

const getHeaderArgs = (referer) => {
  const args = [
    '--user-agent',
    DEFAULT_USER_AGENT,
    '--add-header',
    'Accept: */*',
    '--add-header',
    'Accept-Language: fr-FR,fr;q=0.9,en;q=0.8',
  ];

  if (referer) {
    args.push('--referer', referer);
  }

  return args;
};

const getDownloadSpeedArgs = (formatId, useExternalDownloader = true) => {
  const args = [
    '--socket-timeout',
    '15',
    '--retries',
    '10',
    '--fragment-retries',
    '10',
  ];

  if (formatId === 'direct') {
    args.push('--http-chunk-size', '10M');
  } else {
    args.push('--concurrent-fragments', '8');
  }

  const aria2c = useExternalDownloader ? findAria2c() : '';

  if (aria2c) {
    args.push(
      '--downloader',
      aria2c,
      '--downloader-args',
      'aria2c:-x 16 -s 16 -k 1M --file-allocation=none --summary-interval=1'
    );
  }

  return args;
};

const getFormatExt = (formats, height) => {
  const mp4 = formats.find(
    (format) =>
      format.height === height &&
      format.ext === 'mp4' &&
      format.vcodec &&
      format.vcodec !== 'none'
  );

  return mp4 ? 'mp4' : 'best';
};

const buildOptions = (info, pageUrl) => {
  const formats = Array.isArray(info.formats) ? info.formats : [];
  const videoFormats = formats.filter(
    (format) => format.height && format.vcodec && format.vcodec !== 'none'
  );
  const combinedFormats = formats.filter(
    (format) =>
      format.height &&
      format.vcodec &&
      format.vcodec !== 'none' &&
      format.acodec &&
      format.acodec !== 'none'
  );
  const heights = Array.from(new Set(videoFormats.map((format) => format.height)))
    .filter((height) => height >= 144)
    .sort((a, b) => b - a);
  const audioTracks = getAudioTracks(formats);
  const audioIds = audioTracks.map((track) => track.formatId);
  const audioSelector = audioIds.length > 1
    ? audioIds.join('+')
    : 'ba[ext=m4a]';
  const fallbackAudioSelector = audioIds.length > 1
    ? `${audioIds.join('+')}/ba`
    : 'ba';
  const options = [];

  heights.slice(0, 8).forEach((height) => {
    const ext = getFormatExt(videoFormats, height);
    const outputExt = audioIds.length > 1 ? 'mkv' : 'mp4';
    const videoSelector =
      ext === 'best'
        ? `bv*[height<=${height}]`
        : `bv*[height<=${height}][ext=${ext}]`;

    options.push({
      id: `yt-merged-${height}`,
      source: 'companion',
      formatId: `${videoSelector}+${audioSelector}/bv*[height<=${height}]+${fallbackAudioSelector}/b[height<=${height}]`,
      pageUrl,
      label: `${height}p best`,
      detail: formatDetail([
        audioIds.length > 1 ? `video+${audioIds.length} audio tracks` : 'video+audio',
        'merged by yt-dlp',
        outputExt.toUpperCase(),
      ]),
      audioTracks,
      includesAllAudioTracks: audioIds.length > 1,
      mergeOutputFormat: outputExt,
    });
  });

  combinedFormats
    .sort((a, b) => (b.height || 0) - (a.height || 0))
    .slice(0, 6)
    .forEach((format) => {
      options.push({
        id: `yt-direct-${format.format_id}`,
        source: 'companion',
        formatId: format.format_id,
        pageUrl,
        label: `${format.height}p direct`,
        detail: formatDetail([
          'video+audio',
          (format.ext || '').toUpperCase(),
          formatBytes(format.filesize || format.filesize_approx),
        ]),
        audioTracks,
        includesAllAudioTracks: false,
      });
    });

  if (!options.length) {
    const isLive = info.is_live || info.was_live;

    options.push({
      id: 'generic-best',
      source: 'companion',
      formatId: 'bestvideo+bestaudio/best',
      pageUrl,
      label: 'Best available',
      detail: formatDetail([
        isLive ? 'live/continuous stream' : 'media stream',
        'processed by yt-dlp',
        'MP4',
      ]),
      audioTracks,
      includesAllAudioTracks: audioIds.length > 1,
      mergeOutputFormat: audioIds.length > 1 ? 'mkv' : 'mp4',
    });
  }

  return options;
};

const getAudioTracks = (formats) => {
  const byLanguage = new Map();

  formats
    .filter(
      (format) =>
        format.format_id &&
        format.acodec &&
        format.acodec !== 'none' &&
        (!format.vcodec || format.vcodec === 'none')
    )
    .forEach((format) => {
      const language =
        format.language ||
        format.audio_track?.id ||
        format.audio_track?.displayName ||
        'audio';
      const label = sanitizeText(
        format.audio_track?.displayName ||
          format.language ||
          'Audio'
      );
      const key = `${format.audio_track?.id || language}`.toLowerCase();
      const existing = byLanguage.get(key);
      const bitrate = format.abr || format.tbr || 0;

      if (!existing || bitrate > existing.bitrate) {
        byLanguage.set(key, {
          formatId: format.format_id,
          label,
          language: String(language),
          ext: format.ext || 'audio',
          bitrate,
        });
      }
    });

  return Array.from(byLanguage.values()).sort((a, b) =>
    a.label.localeCompare(b.label)
  );
};

const handleFormats = async (request, response, url) => {
  const pageUrl = url.searchParams.get('url');

  if (!pageUrl) {
    sendJson(response, 400, { ok: false, error: 'Missing YouTube URL.' });
    return;
  }

  try {
    const stdout = await runYtDlp([
      '--dump-single-json',
      '--no-playlist',
      '--no-warnings',
      '--extractor-args',
      `youtube:lang=${YOUTUBE_AUDIO_LANGUAGE_CODES.join(',')}`,
      pageUrl,
    ], 15000);
    const info = JSON.parse(stdout);
    const options = buildOptions(info, pageUrl);

    sendJson(response, 200, {
      ok: true,
      title: sanitizeText(info.title || 'youtube-video'),
      options,
    });
  } catch (error) {
    sendJson(response, 500, {
      ok: false,
      error: error instanceof Error ? error.message : 'Failed to read YouTube formats.',
    });
  }
};

const handleDownload = async (request, response) => {
  try {
    const body = JSON.parse((await getRequestBody(request)) || '{}');
    const pageUrl = body.url;
    const formatId = body.formatId;
    const referer = typeof body.referer === 'string' ? body.referer : '';
    const requestedFilename = sanitizeFilename(body.filename || '');
    const label = sanitizeText(requestedFilename || body.label || 'Media download');
    const mergeOutputFormat =
      body.mergeOutputFormat === 'mkv' || body.mergeOutputFormat === 'mp4'
        ? body.mergeOutputFormat
        : 'mp4';

    if (!pageUrl) {
      sendJson(response, 400, { ok: false, error: 'Missing download parameters.' });
      return;
    }

    const job = createJob(label);
    const shouldSelectFormat = formatId && formatId !== 'direct';
    const createDownloadArgs = (useExternalDownloader) => [
      '--newline',
      '--no-playlist',
      '--continue',
      '--audio-multistreams',
      ...getHeaderArgs(referer),
      ...getDownloadSpeedArgs(formatId, useExternalDownloader),
      ...(formatId === 'direct' ? ['--add-header', 'Range: bytes=0-'] : []),
      ...(fsExists(LOCAL_FFMPEG)
        ? ['--ffmpeg-location', LOCAL_FFMPEG_DIR]
        : []),
      ...(shouldSelectFormat ? ['-f', formatId] : []),
      ...(shouldSelectFormat ? ['--merge-output-format', mergeOutputFormat] : []),
      '-P',
      DOWNLOAD_DIR,
      '-o',
      requestedFilename || '%(title).200B [%(id)s].%(ext)s',
      pageUrl,
    ];

    startYtDlp(createDownloadArgs(true), job, createDownloadArgs(false));

    sendJson(response, 200, {
      ok: true,
      jobId: job.id,
      message: `Download started in ${DOWNLOAD_DIR}.`,
    });
  } catch (error) {
    sendJson(response, 500, {
      ok: false,
      error: error instanceof Error ? error.message : 'Failed to start download.',
    });
  }
};

const handleJob = (request, response, url) => {
  if (url.pathname === '/jobs') {
    sendJson(response, 200, {
      ok: true,
      jobs: Array.from(jobs.values())
        .map(getPublicJob)
        .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))),
    });
    return;
  }

  const id = url.pathname === '/jobs/latest'
    ? latestJobId
    : url.pathname.replace('/jobs/', '');
  const job = id ? jobs.get(id) : null;

  if (!job) {
    sendJson(response, 404, {
      ok: false,
      error: 'No download job found.',
    });
    return;
  }

  sendJson(response, 200, {
    ok: true,
    job: getPublicJob(job),
  });
};

const handleStopJob = (request, response, url) => {
  const id = url.pathname.replace('/jobs/', '').replace('/stop', '');
  const job = jobs.get(id);

  if (!job) {
    sendJson(response, 404, {
      ok: false,
      error: 'No download job found.',
    });
    return;
  }

  stopJob(job);
  sendJson(response, 200, {
    ok: true,
    job: getPublicJob(job),
  });
};

const handleDeleteJob = (request, response, url) => {
  const id = url.pathname.replace('/jobs/', '').replace('/delete', '');

  if (!deleteJob(id)) {
    sendJson(response, 404, {
      ok: false,
      error: 'No download job found.',
    });
    return;
  }

  sendJson(response, 200, {
    ok: true,
  });
};

const server = http.createServer((request, response) => {
  if (request.method === 'OPTIONS') {
    sendJson(response, 204, {});
    return;
  }

  const url = new URL(request.url, `http://${HOST}:${PORT}`);

  if (request.method === 'GET' && url.pathname === '/health') {
    sendJson(response, 200, {
      ok: true,
      latestJobId,
    });
    return;
  }

  if (request.method === 'GET' && url.pathname === '/formats') {
    handleFormats(request, response, url);
    return;
  }

  if (request.method === 'POST' && url.pathname === '/download') {
    handleDownload(request, response);
    return;
  }

  if (
    request.method === 'DELETE' &&
    url.pathname.startsWith('/jobs/') &&
    url.pathname.endsWith('/stop')
  ) {
    handleStopJob(request, response, url);
    return;
  }

  if (
    request.method === 'DELETE' &&
    url.pathname.startsWith('/jobs/') &&
    url.pathname.endsWith('/delete')
  ) {
    handleDeleteJob(request, response, url);
    return;
  }

  if (
    request.method === 'GET' &&
    (url.pathname === '/jobs' ||
      url.pathname === '/jobs/latest' ||
      url.pathname.startsWith('/jobs/'))
  ) {
    handleJob(request, response, url);
    return;
  }

  sendJson(response, 404, { ok: false, error: 'Not found.' });
});

cleanupStaleAria2ControlFiles();

server.listen(PORT, HOST, () => {
  console.log(`yt-dlp helper listening on http://${HOST}:${PORT}`);
  console.log(`Downloads will be saved to ${DOWNLOAD_DIR}`);
});
