import React, { useEffect, useMemo, useState } from 'react';
import { GET_DOWNLOAD_OPTIONS, REQUEST_DOWNLOAD_URL } from '../../constants';

type AudioTrack = {
  formatId: string;
  label: string;
  language: string;
  ext: string;
  bitrate: number;
};

type DownloadOption = {
  id: string;
  label: string;
  detail: string;
  url?: string;
  filename?: string;
  source?: 'direct' | 'companion';
  formatId?: string;
  pageUrl?: string;
  audioTracks?: AudioTrack[];
  includesAllAudioTracks?: boolean;
  mergeOutputFormat?: 'mp4' | 'mkv';
};

type DownloadJob = {
  id: string;
  label: string;
  status: string;
  percent: number;
  message: string;
};

const YTDLP_HELPER_URL = 'http://127.0.0.1:47829';

const isYouTubeUrl = (value?: string) => {
  if (!value) {
    return false;
  }

  try {
    const host = new URL(value).hostname.toLowerCase();

    return host.includes('youtube.com') || host === 'youtu.be';
  } catch (error) {
    return false;
  }
};

const formatBitrate = (value?: number) =>
  value ? `${Math.round(value)} kbps` : '';

const getErrorMessage = (error: unknown, fallback: string) =>
  error instanceof Error ? error.message : fallback;

const fetchJson = async (url: string, options?: RequestInit) => {
  const response = await fetch(url, options);
  const data = await response.json().catch(() => null);

  if (!response.ok || !data?.ok) {
    throw new Error(data?.error || 'Request failed.');
  }

  return data;
};

const getQueryParams = () => {
  const params = new URLSearchParams(window.location.search);

  return {
    tabId: Number(params.get('tabId') || 0),
    pageUrl: params.get('pageUrl') || '',
  };
};

const getActiveTab = () =>
  new Promise<chrome.tabs.Tab | null>((resolve) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      resolve(tabs?.[0] || null);
    });
  });

const Download: React.FC = () => {
  const initialParams = useMemo(getQueryParams, []);
  const [tabId, setTabId] = useState(initialParams.tabId);
  const [pageUrl, setPageUrl] = useState(initialParams.pageUrl);
  const [options, setOptions] = useState<DownloadOption[]>([]);
  const [jobId, setJobId] = useState('');
  const [job, setJob] = useState<DownloadJob | null>(null);
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isStarting, setIsStarting] = useState(false);

  const audioTracks = useMemo(() => {
    const tracks = options.find((option) => option.audioTracks?.length)
      ?.audioTracks;

    return tracks || [];
  }, [options]);

  const loadOptions = async () => {
    setError('');
    setOptions([]);
    setIsLoading(true);

    try {
      let nextTabId = tabId;
      let nextPageUrl = pageUrl;

      if (!nextTabId || !nextPageUrl) {
        const tab = await getActiveTab();

        nextTabId = tab?.id || 0;
        nextPageUrl = tab?.url || '';
        setTabId(nextTabId);
        setPageUrl(nextPageUrl);
      }

      if (!nextTabId) {
        throw new Error('No active tab found.');
      }

      if (isYouTubeUrl(nextPageUrl)) {
        const data = await fetchJson(
          `${YTDLP_HELPER_URL}/formats?url=${encodeURIComponent(nextPageUrl)}`
        );

        setOptions(data.options || []);
        setIsLoading(false);
        return;
      }

      chrome.tabs.sendMessage(
        nextTabId,
        { type: GET_DOWNLOAD_OPTIONS, payload: null },
        (response) => {
          setIsLoading(false);

          if (chrome.runtime.lastError) {
            setError(chrome.runtime.lastError.message || '');
            return;
          }

          if (!response?.ok) {
            setError(
              response?.error || 'No downloadable media found on this page.'
            );
            return;
          }

          setOptions(response.options || []);
        }
      );
    } catch (loadError) {
      setIsLoading(false);
      setError(
        getErrorMessage(
          loadError,
          'Failed to get download options. Start Video Playback Helper first.'
        )
      );
    }
  };

  const startDownload = async (option: DownloadOption) => {
    setError('');
    setIsStarting(true);

    try {
      if (option.source === 'companion') {
        const data = await fetchJson(`${YTDLP_HELPER_URL}/download`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            url: option.pageUrl,
            formatId: option.formatId,
            label: option.label,
            mergeOutputFormat: option.mergeOutputFormat,
          }),
        });

        setJobId(data.jobId);
        setJob({
          id: data.jobId,
          label: option.label,
          status: 'starting',
          percent: 0,
          message: data.message || 'Download started...',
        });
        return;
      }

      if (!option.url || !option.filename) {
        throw new Error('This download option is incomplete.');
      }

      chrome.runtime.sendMessage(
        {
          type: REQUEST_DOWNLOAD_URL,
          payload: {
            url: option.url,
            filename: option.filename,
          },
        },
        (response) => {
          setIsStarting(false);

          if (chrome.runtime.lastError) {
            setError(chrome.runtime.lastError.message || '');
            return;
          }

          if (!response?.ok) {
            setError(response?.error || 'Failed to start download.');
            return;
          }

          setJob({
            id: 'browser-download',
            label: option.label,
            status: 'complete',
            percent: 100,
            message: 'Download started in Chrome.',
          });
        }
      );
    } catch (downloadError) {
      setError(getErrorMessage(downloadError, 'Failed to start download.'));
    } finally {
      if (option.source === 'companion') {
        setIsStarting(false);
      }
    }
  };

  useEffect(() => {
    loadOptions();
  }, []);

  useEffect(() => {
    if (!jobId) {
      return undefined;
    }

    let isMounted = true;
    const poll = async () => {
      try {
        const data = await fetchJson(`${YTDLP_HELPER_URL}/jobs/${jobId}`);

        if (!isMounted) {
          return;
        }

        setJob(data.job);

        if (data.job.status === 'complete' || data.job.status === 'error') {
          setJobId('');
        }
      } catch (pollError) {
        if (isMounted) {
          setError(getErrorMessage(pollError, 'Failed to read download state.'));
        }
      }
    };
    const interval = window.setInterval(poll, 1000);

    poll();

    return () => {
      isMounted = false;
      window.clearInterval(interval);
    };
  }, [jobId]);

  return (
    <main className="Download">
      <header className="Download-header">
        <div>
          <h1 className="Download-title">Download Media</h1>
          <span className="Download-subtitle">{pageUrl || 'Current tab'}</span>
        </div>
        <button
          className="Download-refresh"
          type="button"
          disabled={isLoading}
          onClick={loadOptions}
        >
          Refresh
        </button>
      </header>

      {!!error && (
        <section className="Download-section Download-error">{error}</section>
      )}

      {!!job && (
        <section className="Download-section Download-status">
          <div className="Download-status-row">
            <strong>{job.label}</strong>
            <span>{Math.round(job.percent || 0)}%</span>
          </div>
          <progress max={100} value={job.percent || 0} />
          <small>{job.message}</small>
        </section>
      )}

      <section className="Download-section">
        <h2 className="Download-section-title">Qualites disponibles</h2>
        {isLoading ? (
          <p className="Download-note">Chargement...</p>
        ) : options.length ? (
          <div className="Download-options">
            {options.map((option) => (
              <button
                key={`${option.id}-${option.url || option.formatId}`}
                className="Download-option"
                type="button"
                disabled={isStarting || !!jobId}
                onClick={() => startDownload(option)}
              >
                <strong>{option.label}</strong>
                <small>
                  {option.detail}
                  {option.includesAllAudioTracks
                    ? ' - toutes les pistes audio incluses'
                    : ''}
                </small>
              </button>
            ))}
          </div>
        ) : (
          <p className="Download-note">Aucune option disponible.</p>
        )}
      </section>

      {!!audioTracks.length && (
        <section className="Download-section">
          <h2 className="Download-section-title">Pistes audio</h2>
          <p className="Download-note">
            Les options “best” incluent automatiquement toutes les pistes audio
            detectees dans le meme fichier.
          </p>
          <ul className="Download-audio-list">
            {audioTracks.map((track) => (
              <li
                className="Download-audio-item"
                key={`${track.formatId}-${track.language}`}
              >
                <span>{track.label}</span>
                <small>
                  {[track.language, track.ext.toUpperCase(), formatBitrate(track.bitrate)]
                    .filter(Boolean)
                    .join(' - ')}
                </small>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
};

export default Download;
