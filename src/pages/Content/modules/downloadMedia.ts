import { REQUEST_DOWNLOAD_URL } from '../../../constants';

export type DownloadOption = {
  id: string;
  label: string;
  detail: string;
  url: string;
  filename: string;
};

type YouTubePageFormat = {
  url?: string;
  mimeType?: string;
  qualityLabel?: string;
  height?: number;
  bitrate?: number;
  audioQuality?: string;
  hasVideo?: boolean;
  hasAudio?: boolean;
  container?: string;
  quality?: {
    label?: string;
    text?: string;
  };
};

const sanitizeFilename = (input: string): string => {
  const sanitized = input
    .replace(/[\\/:*?"<>|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return sanitized || 'video-playback-download';
};

const getExtensionFromUrl = (value: string): string | null => {
  try {
    const pathname = new URL(value).pathname;
    const filename = pathname.split('/').pop() || '';
    const match = filename.match(/\.([a-zA-Z0-9]{2,5})$/);

    return match ? match[1].toLowerCase() : null;
  } catch (error) {
    return null;
  }
};

const requestBrowserDownload = (url: string, filename: string) => {
  chrome.runtime.sendMessage({
    type: REQUEST_DOWNLOAD_URL,
    payload: { url, filename },
  });
};

export const downloadOption = (option: DownloadOption) => {
  requestBrowserDownload(option.url, option.filename);
};

const getCandidateMedia = (): HTMLMediaElement | null => {
  const medias = Array.from(
    document.querySelectorAll('video, audio')
  ) as HTMLMediaElement[];

  if (!medias.length) {
    return null;
  }

  const playingMedia = medias.find((media) => !media.paused);

  return playingMedia || medias[0];
};

const getHtml5DownloadOptions = (): DownloadOption[] => {
  const media = getCandidateMedia();

  if (!media) {
    throw new Error('No HTML5 media found on this page.');
  }

  const mediaUrl = media.currentSrc || media.src;

  if (!mediaUrl) {
    throw new Error('No downloadable source found for this media.');
  }

  if (mediaUrl.startsWith('blob:')) {
    throw new Error(
      'This media uses a blob stream and cannot be downloaded directly.'
    );
  }

  const extension = getExtensionFromUrl(mediaUrl) || 'mp4';
  const baseName = sanitizeFilename(document.title || 'video');
  const filename = `${baseName}.${extension}`;

  return [
    {
      id: 'html5-current',
      label: 'Current HTML5 media',
      detail: `${extension.toUpperCase()} direct source`,
      url: mediaUrl,
      filename,
    },
  ];
};

const isYouTubePage = (href: string) => {
  const host = window.location.hostname.toLowerCase();

  return host.includes('youtube.com') || host === 'youtu.be';
};

const getYouTubeFormatScore = (format: YouTubePageFormat) =>
  format.height || format.bitrate || 0;

const getYouTubeQualityLabel = (format: YouTubePageFormat) =>
  format.qualityLabel || format.quality?.label || format.quality?.text || 'Audio';

const getYouTubeExtension = (format: YouTubePageFormat) => {
  if (format.mimeType?.includes('webm') || format.container === 'webm') {
    return 'webm';
  }

  return 'mp4';
};

const extractJsonObject = (text: string, marker: string) => {
  const markerIndex = text.indexOf(marker);

  if (markerIndex === -1) {
    return null;
  }

  const startIndex = text.indexOf('{', markerIndex);

  if (startIndex === -1) {
    return null;
  }

  let depth = 0;
  let isInString = false;
  let isEscaped = false;

  for (let i = startIndex; i < text.length; i++) {
    const char = text[i];

    if (isEscaped) {
      isEscaped = false;
      continue;
    }

    if (char === '\\') {
      isEscaped = true;
      continue;
    }

    if (char === '"') {
      isInString = !isInString;
      continue;
    }

    if (isInString) {
      continue;
    }

    if (char === '{') {
      depth++;
    } else if (char === '}') {
      depth--;

      if (depth === 0) {
        return text.slice(startIndex, i + 1);
      }
    }
  }

  return null;
};

const toDownloadOption = (
  format: YouTubePageFormat,
  title: string,
  index: number,
  source: string
): DownloadOption | null => {
  if (!format.url) {
    return null;
  }

  const extension = getYouTubeExtension(format);
  const qualityLabel = getYouTubeQualityLabel(format);
  const hasVideo =
    format.hasVideo ?? !!format.mimeType?.includes('video/');
  const hasAudio =
    format.hasAudio ?? !!format.audioQuality ?? !!format.mimeType?.includes('audio/');
  const mediaParts = [
    hasVideo ? 'video' : null,
    hasAudio ? 'audio' : null,
  ].filter(Boolean);
  const container = extension.toUpperCase();
  const bitrate = format.bitrate
    ? `${Math.round(format.bitrate / 1000)} kbps`
    : '';
  const detail = [container, mediaParts.join('+'), bitrate, source]
    .filter(Boolean)
    .join(' - ');

  return {
    id: `${source}-${index}-${qualityLabel}-${extension}`,
    label: qualityLabel,
    detail,
    url: format.url,
    filename: `${sanitizeFilename(title)}-${sanitizeFilename(qualityLabel)}.${extension}`,
  };
};

const getFormatsFromYouTubePage = (): DownloadOption[] => {
  const scripts = Array.from(document.scripts);
  const playerScript = scripts.find((script) =>
    script.textContent?.includes('ytInitialPlayerResponse')
  );
  const scriptText = playerScript?.textContent || '';
  const jsonText = extractJsonObject(scriptText, 'ytInitialPlayerResponse');

  if (!jsonText) {
    return [];
  }

  try {
    const playerResponse = JSON.parse(jsonText);
    const streamingData = playerResponse.streamingData || {};
    const formats: YouTubePageFormat[] = [
      ...(streamingData.formats || []),
      ...(streamingData.adaptiveFormats || []),
    ];
    const title =
      playerResponse.videoDetails?.title || document.title || 'youtube-video';
    const directFormats = formats
      .filter((format) => format.url)
      .sort((a, b) => getYouTubeFormatScore(b) - getYouTubeFormatScore(a));

    return directFormats
      .map((format, index) => toDownloadOption(format, title, index, 'page'))
      .filter(Boolean) as DownloadOption[];
  } catch (error) {
    return [];
  }
};

const dedupeOptions = (options: DownloadOption[]) => {
  const seenUrls = new Set<string>();

  return options.filter((option) => {
    if (seenUrls.has(option.url)) {
      return false;
    }

    seenUrls.add(option.url);
    return true;
  });
};

const getYouTubeDownloadOptions = async () => {
  const pageOptions = getFormatsFromYouTubePage();

  if (pageOptions.length) {
    return dedupeOptions(pageOptions);
  }

  throw new Error('No downloadable YouTube format available on this page.');
};

export const getDownloadOptions = async (): Promise<DownloadOption[]> => {
  if (isYouTubePage(window.location.href)) {
    return getYouTubeDownloadOptions();
  }

  return getHtml5DownloadOptions();
};

export const downloadMedia = async () => {
  const options = await getDownloadOptions();
  const option = options[0];

  if (!option) {
    throw new Error('No downloadable media available.');
  }

  return downloadOption(option);
};
