import React, {
  SyntheticEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import { SkipDirection, Tabs } from '../../types';
import {
  DEFAULT_SHORTCUT_KEYS,
  DISABLE_EXTENSION,
  ENABLE_EXTENSION,
  PAUSE_PLAYER_ACTION,
  PLAY_PLAYER_ACTION,
  RESTART_PLAYER_ACTION,
  GET_DOWNLOAD_OPTIONS,
  REQUEST_DOWNLOAD_URL,
  SET_MEDIA_ATTRIBUTES,
  SHORTCUT_NAMES,
  SKIP_BACKWARD,
  SKIP_FORWARD,
} from '../../constants';
import {
  getDataFromSyncStoragePromise,
  getTabsPromise,
  sendMessageToTabs,
} from '../../helpers';

import logo from '../../assets/img/logo.svg';
import '../../assets/img/icon34.png';
import '../../assets/img/icon34-inactive.png';
import './Popup.css';

type MediaAttributeOverrides = {
  applyTo?: string;
  playbackRate?: number;
  volume?: number;
  shouldLoop?: boolean;
  isInTheaterMode?: boolean;
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
};

type DownloadJob = {
  id: string;
  label: string;
  status: string;
  percent: number;
  message: string;
};

const YTDLP_HELPER_URL = 'http://127.0.0.1:47829';

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max);

const formatPlaybackRate = (value: number) =>
  value.toFixed(2).replace(/\.?0+$/, '');

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

const getHelperError = (error: unknown) => {
  if (error instanceof Error) {
    return error.message;
  }

  return 'YouTube helper unavailable. Start it with npm run ytdlp-server.';
};

const requestYouTubeOptions = async (pageUrl: string) => {
  const response = await fetch(
    `${YTDLP_HELPER_URL}/formats?url=${encodeURIComponent(pageUrl)}`
  );
  const data = await response.json().catch(() => null);

  if (!response.ok || !data?.ok) {
    throw new Error(
      data?.error || 'YouTube helper unavailable. Start it with npm run ytdlp-server.'
    );
  }

  return data.options || [];
};

const requestYouTubeDownload = async (option: DownloadOption) => {
  const response = await fetch(`${YTDLP_HELPER_URL}/download`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      url: option.pageUrl,
      formatId: option.formatId,
      label: option.label,
    }),
  });
  const data = await response.json().catch(() => null);

  if (!response.ok || !data?.ok) {
    throw new Error(data?.error || 'Failed to start YouTube download.');
  }

  return data.jobId as string;
};

const requestDownloadJob = async (jobId: string): Promise<DownloadJob | null> => {
  const response = await fetch(`${YTDLP_HELPER_URL}/jobs/${jobId}`);
  const data = await response.json().catch(() => null);

  if (!response.ok || !data?.ok) {
    return null;
  }

  return data.job;
};

const setExtensionIcon = (path: string) => {
  const action = (chrome as any).action || (chrome as any).browserAction;

  action?.setIcon({ path });
};

const Popup: React.FC = () => {
  const [isEnabled, setIsEnabled] = useState(true);
  const [applyTo, setApplyTo] = useState('current');
  const [playbackRate, setPlaybackRate] = useState(1);
  const [volume, setVolume] = useState(1);
  const [skipInterval, setSkipInterval] = useState(30);
  const [shouldLoop, setShouldLoop] = useState(false);
  const [isInTheaterMode, setIsInTheaterMode] = useState(false);
  const [shortcuts, setShortcuts] = useState(DEFAULT_SHORTCUT_KEYS);
  const [downloadOptions, setDownloadOptions] = useState<DownloadOption[]>([]);
  const [downloadError, setDownloadError] = useState('');
  const [isLoadingDownloadOptions, setIsLoadingDownloadOptions] = useState(
    false
  );
  const [isStartingDownload, setIsStartingDownload] = useState(false);
  const [activeDownloadJobId, setActiveDownloadJobId] = useState('');
  const [downloadJob, setDownloadJob] = useState<DownloadJob | null>(null);

  const applyToSelectRef = useRef<HTMLSelectElement>(null);

  const sendMediaAttributeData = useCallback(
    async (
      overrides: MediaAttributeOverrides = {},
      closeAfterApply = false
    ) => {
      const targetApplyTo = overrides.applyTo ?? applyTo;
      const targetRate = clamp(
        overrides.playbackRate ?? playbackRate,
        0.1,
        16
      );
      const targetVolume = clamp(overrides.volume ?? volume, 0, 5);
      const targetShouldLoop = overrides.shouldLoop ?? shouldLoop;
      const targetTheaterMode = overrides.isInTheaterMode ?? isInTheaterMode;

      chrome.storage.sync.set({
        applyTo: targetApplyTo,
        shouldLoop: targetShouldLoop,
        isInTheaterMode: targetTheaterMode,
        playbackRate: targetRate,
        volume: targetVolume,
      });

      const isApplyingToAllTabs = targetApplyTo === Tabs.All;
      const tabs: any = await getTabsPromise(targetApplyTo as Tabs);

      const message = {
        type: SET_MEDIA_ATTRIBUTES,
        payload: {
          targetRate,
          volume: targetVolume,
          shouldLoop: targetShouldLoop,
          isInTheaterMode: targetTheaterMode,
        },
      };

      sendMessageToTabs(tabs, message, isApplyingToAllTabs);

      if (closeAfterApply) {
        window.close();
      }
    },
    [applyTo, playbackRate, volume, shouldLoop, isInTheaterMode]
  );

  const sendSkipIntervalData = useCallback(
    async (direction: SkipDirection) => {
      const isApplyingToAllTabs = applyTo === Tabs.All;
      const tabs: any = await getTabsPromise(applyTo as Tabs);

      const message = {
        type:
          direction === SkipDirection.Forward ? SKIP_FORWARD : SKIP_BACKWARD,
        payload: {
          skipInterval,
        },
      };

      sendMessageToTabs(tabs, message, isApplyingToAllTabs);
    },
    [applyTo, skipInterval]
  );

  const sendPlayerAction = useCallback(
    async (type: string) => {
      const isApplyingToAllTabs = applyTo === Tabs.All;
      const tabs: any = await getTabsPromise(applyTo as Tabs);

      const message = {
        type,
        payload: null,
      };

      sendMessageToTabs(tabs, message, isApplyingToAllTabs);
    },
    [applyTo]
  );

  useEffect(() => {
    applyToSelectRef?.current?.focus();
  }, []);

  useEffect(() => {
    async function setStateFromStorage() {
      const {
        isEnabled,
        applyTo,
        playbackRate,
        volume,
        shouldLoop,
        isInTheaterMode,
        skipInterval,
        shortcuts,
      }: any = await getDataFromSyncStoragePromise();

      if (isEnabled === false) {
        setExtensionIcon('icon34-inactive.png');
        setIsEnabled(isEnabled);
      }
      if (shortcuts) {
        setShortcuts(shortcuts);
      }
      if (applyTo) {
        setApplyTo(applyTo);
      }
      if (playbackRate) {
        setPlaybackRate(clamp(parseFloat(playbackRate), 0.1, 16));
      }
      if (typeof volume !== 'undefined') {
        setVolume(clamp(parseFloat(volume), 0, 5));
      }
      setShouldLoop(shouldLoop);
      setIsInTheaterMode(isInTheaterMode);
      if (skipInterval) {
        setSkipInterval(skipInterval);
      }
    }

    setStateFromStorage();
  }, []);

  useEffect(() => {
    if (!activeDownloadJobId) {
      return undefined;
    }

    let isMounted = true;
    const pollJob = async () => {
      const job = await requestDownloadJob(activeDownloadJobId);

      if (!isMounted || !job) {
        return;
      }

      setDownloadJob(job);

      if (job.status === 'complete' || job.status === 'error') {
        setActiveDownloadJobId('');
      }
    };
    const interval = window.setInterval(pollJob, 1000);

    pollJob();

    return () => {
      isMounted = false;
      window.clearInterval(interval);
    };
  }, [activeDownloadJobId]);

  const handleEnabledButtonClick = async () => {
    chrome.storage.sync.set({
      isEnabled: false,
    });
    setExtensionIcon('icon34-inactive.png');
    setIsEnabled(false);

    const tabs: any = await getTabsPromise(Tabs.All);

    const message = {
      type: DISABLE_EXTENSION,
      payload: null,
    };

    sendMessageToTabs(tabs, message, true);
  };

  const handleDisabledButtonClick = async () => {
    chrome.storage.sync.set({
      isEnabled: true,
    });
    setExtensionIcon('icon34.png');
    setIsEnabled(true);

    const tabs: any = await getTabsPromise(Tabs.All);

    const message = {
      type: ENABLE_EXTENSION,
      payload: null,
    };

    sendMessageToTabs(tabs, message, true);
  };

  const handleApplyToChange = (e: SyntheticEvent) => {
    const element = e.target as HTMLInputElement;
    const nextApplyTo = element.value;

    chrome.storage.sync.set({
      applyTo: nextApplyTo,
    });
    setApplyTo(nextApplyTo);
  };

  const handlePlaybackRateChange = (e: SyntheticEvent) => {
    const element = e.target as HTMLInputElement;
    const nextPlaybackRate = clamp(parseFloat(element.value), 0.1, 16);

    setPlaybackRate(nextPlaybackRate);
    sendMediaAttributeData({ playbackRate: nextPlaybackRate });
  };

  const handleVolumeChange = (e: SyntheticEvent) => {
    const element = e.target as HTMLInputElement;
    const nextVolume = clamp(parseFloat(element.value), 0, 5);

    setVolume(nextVolume);
    sendMediaAttributeData({ volume: nextVolume });
  };

  const handleShouldLoopClick = (e: SyntheticEvent) => {
    const element = e.target as HTMLInputElement;
    const nextShouldLoop = element.checked;

    setShouldLoop(nextShouldLoop);
    sendMediaAttributeData({ shouldLoop: nextShouldLoop });
  };

  const handleIsInTheaterModeClick = (e: SyntheticEvent) => {
    const element = e.target as HTMLInputElement;
    const nextTheaterMode = element.checked;

    setIsInTheaterMode(nextTheaterMode);
    sendMediaAttributeData({ isInTheaterMode: nextTheaterMode });
  };

  const handleSkipIntervalChange = (e: SyntheticEvent) => {
    const element = e.target as HTMLInputElement;

    chrome.storage.sync.set({
      skipInterval: element.value,
    });

    setSkipInterval((element.value as unknown) as number);
  };

  const handleSkipBackwardButtonClick = () => {
    sendSkipIntervalData(SkipDirection.Backward);
  };

  const handleSkipForwardButtonClick = () => {
    sendSkipIntervalData(SkipDirection.Forward);
  };

  const handlePlayButtonClick = () => {
    sendPlayerAction(PLAY_PLAYER_ACTION);
    window.close();
  };

  const handlePauseButtonClick = () => {
    sendPlayerAction(PAUSE_PLAYER_ACTION);
    window.close();
  };

  const handleRestartButtonClick = () => {
    sendPlayerAction(RESTART_PLAYER_ACTION);
    window.close();
  };

  const handleShortcutKeyChange = (e: SyntheticEvent) => {
    const element = e.target as HTMLInputElement;
    const elementID = element.id;
    const newShortcuts = { ...shortcuts, [elementID]: element.value };

    chrome.storage.sync.set({
      shortcuts: newShortcuts,
    });
    setShortcuts(newShortcuts);
  };

  const handleRestoreDefaultsButtonClick = () => {
    setApplyTo('current');
    setPlaybackRate(1);
    setVolume(1);
    setShouldLoop(false);
    setIsInTheaterMode(false);
    setSkipInterval(30);
    chrome.storage.sync.set({ skipInterval: 30 });
    sendMediaAttributeData(
      {
        playbackRate: 1,
        volume: 1,
        shouldLoop: false,
        isInTheaterMode: false,
        applyTo: Tabs.Current,
      },
      false
    );
  };

  const handleApplyToMediaButtonClick = () => {
    sendMediaAttributeData({}, true);
  };

  const handleOpenDownloadWindowClick = async () => {
    const tabs: any = await getTabsPromise(Tabs.Current);
    const tab = tabs?.[0];
    const params = new URLSearchParams({
      tabId: String(tab?.id || ''),
      pageUrl: tab?.url || '',
    });
    const left = Math.max(0, window.screen.availWidth - 450);
    const top = 24;

    chrome.windows.create({
      url: chrome.runtime.getURL(`download.html?${params.toString()}`),
      type: 'popup',
      width: 430,
      height: 720,
      left,
      top,
    });
    window.close();
  };

  const handleDownloadButtonClick = async () => {
    setDownloadError('');
    setDownloadOptions([]);
    setDownloadJob(null);
    setIsLoadingDownloadOptions(true);

    try {
      const tabs: any = await getTabsPromise(Tabs.Current);
      const tab = tabs?.[0];
      const tabID = tab?.id;

      if (!tabID) {
        throw new Error('No active tab found.');
      }

      if (isYouTubeUrl(tab.url)) {
        const options = await requestYouTubeOptions(tab.url);

        setDownloadOptions(options);
        setIsLoadingDownloadOptions(false);
        return;
      }

      chrome.tabs.sendMessage(
        tabID,
        { type: GET_DOWNLOAD_OPTIONS, payload: null },
        (response) => {
          setIsLoadingDownloadOptions(false);

          if (chrome.runtime.lastError) {
            setDownloadError(chrome.runtime.lastError.message || '');
            return;
          }

          if (!response?.ok) {
            setDownloadError(
              response?.error || 'No downloadable media found on this page.'
            );
            return;
          }

          setDownloadOptions(response.options || []);
        }
      );
    } catch (error) {
      setIsLoadingDownloadOptions(false);
      setDownloadError(
        error instanceof Error
          ? error.message
          : 'Failed to get download options.'
      );
    }
  };

  const handleDownloadOptionClick = async (option: DownloadOption) => {
    setDownloadError('');
    setIsStartingDownload(true);

    if (option.source === 'companion') {
      try {
        const jobId = await requestYouTubeDownload(option);

        setActiveDownloadJobId(jobId);
        setDownloadJob({
          id: jobId,
          label: option.label,
          status: 'starting',
          percent: 0,
          message: 'Download started...',
        });
      } catch (error) {
        setDownloadError(getHelperError(error));
      } finally {
        setIsStartingDownload(false);
      }
      return;
    }

    if (!option.url || !option.filename) {
      setIsStartingDownload(false);
      setDownloadError('This download option is incomplete.');
      return;
    }

    chrome.runtime.sendMessage({
      type: REQUEST_DOWNLOAD_URL,
      payload: {
        url: option.url,
        filename: option.filename,
      },
    }, (response) => {
      setIsStartingDownload(false);

      if (chrome.runtime.lastError) {
        setDownloadError(chrome.runtime.lastError.message || '');
        return;
      }

      if (!response?.ok) {
        setDownloadError(
          response?.error || 'Failed to start download.'
        );
        return;
      }

      setDownloadJob({
        id: 'browser-download',
        label: option.label,
        status: 'complete',
        percent: 100,
        message: 'Download started in Chrome.',
      });
    });
  };

  return (
    <div className="App">
      <header className="App-header">
        <div className="u-flex u-ai-center">
          <img src={logo} className="App-logo" alt="logo" />
          <div className="u-flex u-flex-direction-column">
            <h1 className="App-title">Video Playback</h1>
          </div>
        </div>
        {isEnabled ? (
          <button
            type="button"
            aria-label="Extension is currently enabled. Click to disable extension."
            title="Extension is currently enabled. Click to disable extension."
            onClick={handleEnabledButtonClick}
          >
            On
          </button>
        ) : (
          <button
            type="button"
            aria-label="Extension is currently disabled. Click to enable extension."
            title="Extension is currently disabled. Click to enable extension."
            onClick={handleDisabledButtonClick}
          >
            Off
          </button>
        )}
      </header>
      <div className="App-container">
        {isEnabled ? (
          <>
            <div className="u-flex u-jc-space-between u-ai-center u-margin-top-15">
              <label className="u-padding-5" htmlFor="applyTo">
                Apply To Media In
              </label>
              <select
                className="u-padding-5"
                id="applyTo"
                value={applyTo}
                onChange={handleApplyToChange}
                ref={applyToSelectRef}
              >
                <option value="current">Current Tab</option>
                <option value="all">All Tabs</option>
              </select>
            </div>

            <div className="App-slider-row">
              <div className="u-flex u-jc-space-between u-ai-center">
                <label className="u-padding-5" htmlFor="playbackRate">
                  Playback Speed
                </label>
                <span className="App-slider-value">
                  {formatPlaybackRate(playbackRate)}x
                </span>
              </div>
              <input
                id="playbackRate"
                type="range"
                min={0.25}
                max={4}
                step={0.05}
                value={playbackRate}
                onChange={handlePlaybackRateChange}
              />
            </div>

            <div className="App-slider-row">
              <div className="u-flex u-jc-space-between u-ai-center">
                <label className="u-padding-5" htmlFor="volume">
                  Volume Boost
                </label>
                <span className="App-slider-value">
                  {Math.round(volume * 100)}%
                </span>
              </div>
              <input
                id="volume"
                type="range"
                min={0}
                max={5}
                step={0.05}
                value={volume}
                onChange={handleVolumeChange}
              />
            </div>

            <div className="u-flex u-jc-space-between u-ai-center">
              <label className="u-padding-5" htmlFor="shouldLoop">
                Loop
              </label>
              <input
                type="checkbox"
                className="u-padding-5"
                id="shouldLoop"
                name="shouldLoop"
                checked={shouldLoop}
                onChange={handleShouldLoopClick}
              />
            </div>

            <div className="u-flex u-jc-space-between u-ai-center">
              <label className="u-padding-5" htmlFor="isInTheaterMode">
                Theater Mode (Video Only)
              </label>
              <input
                type="checkbox"
                className="u-padding-5"
                id="isInTheaterMode"
                name="isInTheaterMode"
                checked={isInTheaterMode}
                onChange={handleIsInTheaterModeClick}
              />
            </div>

            <div className="u-flex u-jc-space-evenly">
              <button
                className="u-padding-5 u-margin-top-15"
                type="button"
                onClick={handleRestoreDefaultsButtonClick}
              >
                Restore Defaults
              </button>

              <button
                className="u-padding-5 u-margin-top-15"
                type="button"
                onClick={handleApplyToMediaButtonClick}
              >
                Apply To Media
              </button>
            </div>

            <div className="u-flex u-jc-space-evenly">
              <button
                className="u-padding-5 u-margin-top-15"
                type="button"
                onClick={handleOpenDownloadWindowClick}
                disabled={isLoadingDownloadOptions}
              >
                Download Media
              </button>
            </div>

            {!!downloadError && (
              <div className="App-download-error u-margin-top-15">
                {downloadError}
              </div>
            )}

            {!!downloadJob && (
              <div className="App-download-status u-margin-top-15">
                <div className="u-flex u-jc-space-between u-ai-center">
                  <strong>{downloadJob.label}</strong>
                  <span>{Math.round(downloadJob.percent || 0)}%</span>
                </div>
                <progress
                  max={100}
                  value={downloadJob.percent || 0}
                />
                <small>{downloadJob.message}</small>
              </div>
            )}

            {!!downloadOptions.length && (
              <div className="App-download-options u-margin-top-15">
                {downloadOptions.map((option) => (
                  <button
                    key={`${option.id}-${option.url || option.formatId}`}
                    className="App-download-option"
                    type="button"
                    title={option.detail}
                    disabled={isStartingDownload || !!activeDownloadJobId}
                    onClick={() => handleDownloadOptionClick(option)}
                  >
                    <span>{option.label}</span>
                    <small>{option.detail}</small>
                  </button>
                ))}
              </div>
            )}

            <div className="u-flex u-margin-top-15">
              <details className="App-shortcut-details">
                <summary>Shortcuts</summary>
                {Object.keys(shortcuts).map((shortcut, i) => (
                  <div
                    className="u-flex u-jc-space-between"
                    key={`${shortcut}-${i}`}
                  >
                    <label className="App-shortcut-label" htmlFor={shortcut}>
                      {SHORTCUT_NAMES[shortcut]}
                    </label>
                    <input
                      className="App-shortcut-input"
                      id={shortcut}
                      type="text"
                      maxLength={1}
                      value={shortcuts[shortcut]}
                      onChange={handleShortcutKeyChange}
                    />
                  </div>
                ))}
              </details>
            </div>

            <div className="App-player-controls u-margin-top-15">
              <div>
                <label className="u-padding-5" htmlFor="skipInterval">
                  Skip Interval (in seconds)
                </label>
              </div>

              <div className="u-flex">
                <button
                  type="button"
                  aria-label="Skip Backward"
                  title="Skip Backward"
                  onClick={handleSkipBackwardButtonClick}
                >
                  Back
                </button>
                <input
                  className="u-padding-5"
                  id="skipInterval"
                  type="number"
                  step={1}
                  min={0}
                  max={10000}
                  value={skipInterval}
                  onChange={handleSkipIntervalChange}
                />
                <button
                  type="button"
                  aria-label="Skip Forward"
                  title="Skip Forward"
                  onClick={handleSkipForwardButtonClick}
                >
                  Forward
                </button>
              </div>

              <div className="u-flex u-margin-top-15">
                <button
                  type="button"
                  aria-label="Restart Media"
                  title="Restart Media"
                  onClick={handleRestartButtonClick}
                >
                  Restart
                </button>
                <button
                  type="button"
                  aria-label="Play Media"
                  title="Play Media"
                  onClick={handlePlayButtonClick}
                >
                  Play
                </button>
                <button
                  type="button"
                  title="Pause Media"
                  aria-label="Pause Media"
                  onClick={handlePauseButtonClick}
                >
                  Pause
                </button>
              </div>
            </div>
          </>
        ) : (
          <div className="u-margin-top-15">
            Extension is disabled.
          </div>
        )}
      </div>
    </div>
  );
};

export default Popup;
