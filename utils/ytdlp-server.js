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
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
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

const runYtDlp = (args) =>
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

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', reject);
    child.on('close', (code) => {
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

const parseYtDlpLine = (line) => {
  const percentMatch = line.match(/\[download\]\s+(\d+(?:\.\d+)?)%/);

  if (percentMatch) {
    return {
      status: 'downloading',
      percent: Number(percentMatch[1]),
      message: line.replace(/\s+/g, ' ').trim(),
    };
  }

  if (line.includes('[Merger]') || line.includes('[ffmpeg]')) {
    return {
      status: 'processing',
      percent: 100,
      message: line.replace(/\s+/g, ' ').trim(),
    };
  }

  if (line.includes('has already been downloaded')) {
    return {
      status: 'complete',
      percent: 100,
      message: 'Already downloaded.',
    };
  }

  return {
    message: line.replace(/\s+/g, ' ').trim(),
  };
};

const startYtDlp = (args, job) => {
  const candidate = findYtDlp();
  const child = spawn(candidate.command, [...candidate.args, ...args], {
    windowsHide: true,
  });
  let stdoutBuffer = '';
  let stderrBuffer = '';

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

      updateJob(job, parseYtDlpLine(trimmed));
    });
  };

  updateJob(job, {
    status: 'running',
    message: 'Download running...',
  });

  child.stdout.on('data', (chunk) => handleOutput(chunk, 'stdout'));
  child.stderr.on('data', (chunk) => handleOutput(chunk, 'stderr'));
  child.on('close', (code) => {
    updateJob(
      job,
      code === 0
        ? {
            status: 'complete',
            percent: 100,
            message: 'Download complete.',
          }
        : {
            status: 'error',
            message: job.message || `yt-dlp download failed with code ${code}.`,
          }
    );
  });

  return child;
};

const fsExists = (filePath) => {
  try {
    fs.accessSync(filePath);
    return true;
  } catch (error) {
    return false;
  }
};

const sanitizeText = (value) =>
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
      pageUrl,
    ]);
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
    const label = sanitizeText(body.label || 'YouTube download');
    const mergeOutputFormat =
      body.mergeOutputFormat === 'mkv' || body.mergeOutputFormat === 'mp4'
        ? body.mergeOutputFormat
        : 'mp4';

    if (!pageUrl || !formatId) {
      sendJson(response, 400, { ok: false, error: 'Missing download parameters.' });
      return;
    }

    const job = createJob(label);

    startYtDlp([
      '--newline',
      '--no-playlist',
      '--audio-multistreams',
      ...(fsExists(LOCAL_FFMPEG)
        ? ['--ffmpeg-location', LOCAL_FFMPEG_DIR]
        : []),
      '-f',
      formatId,
      '--merge-output-format',
      mergeOutputFormat,
      '-P',
      DOWNLOAD_DIR,
      '-o',
      '%(title).200B [%(id)s].%(ext)s',
      pageUrl,
    ], job);

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
    job,
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
    request.method === 'GET' &&
    (url.pathname === '/jobs/latest' || url.pathname.startsWith('/jobs/'))
  ) {
    handleJob(request, response, url);
    return;
  }

  sendJson(response, 404, { ok: false, error: 'Not found.' });
});

server.listen(PORT, HOST, () => {
  console.log(`yt-dlp helper listening on http://${HOST}:${PORT}`);
  console.log(`Downloads will be saved to ${DOWNLOAD_DIR}`);
});
