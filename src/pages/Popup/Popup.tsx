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
  GET_AUDIO_LEVEL,
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

import logo from '../../assets/img/logo.png';
import logoBase from '../../assets/img/logo-base.png';
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
  sizeBytes?: number;
  source?: 'direct' | 'companion';
  formatId?: string;
  pageUrl?: string;
  referer?: string;
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

type AudioTrack = {
  formatId: string;
  label: string;
  language: string;
  ext: string;
  bitrate: number;
};

type AudioLevelResponse = {
  ok?: boolean;
  level?: number;
  levels?: number[];
  isPlaying?: boolean;
  hasLiveMeter?: boolean;
};

const YTDLP_HELPER_URL = 'http://127.0.0.1:47829';
const HELPER_FORMAT_TIMEOUT_MS = 4500;
const YOUTUBE_FORMAT_TIMEOUT_MS = 20000;
const CONTENT_OPTIONS_TIMEOUT_MS = 6000;
const AUDIO_LEVEL_POLL_MS = 90;

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max);

const getLogoBarHue = (level: number) => 184 - clamp(level, 0, 1) * 162;

const getLogoBarLightness = (level: number) => 42 + clamp(level, 0, 1) * 18;

const getLogoBarGlow = (level: number) => 0.35 + clamp(level, 0, 1) * 0.6;

const LOGO_BARS = [
  { angle: 0, height: 11, radius: 18, color: '#28f6df', glow: 'rgba(40, 246, 223, 0.9)', boost: 0.16 },
  { angle: 18, height: 8, radius: 18, color: '#25efea', glow: 'rgba(37, 239, 234, 0.85)', boost: 0.04 },
  { angle: 36, height: 9, radius: 18, color: '#1fe4f2', glow: 'rgba(31, 228, 242, 0.85)', boost: 0.1 },
  { angle: 54, height: 7, radius: 18, color: '#18d6fb', glow: 'rgba(24, 214, 251, 0.8)', boost: 0.02 },
  { angle: 72, height: 10, radius: 18, color: '#ff8a3d', glow: 'rgba(255, 138, 61, 0.9)', boost: 0.18 },
  { angle: 90, height: 12, radius: 18, color: '#ff7147', glow: 'rgba(255, 113, 71, 0.95)', boost: 0.22 },
  { angle: 108, height: 9, radius: 18, color: '#ff9550', glow: 'rgba(255, 149, 80, 0.85)', boost: 0.08 },
  { angle: 126, height: 6, radius: 18, color: '#1ee6f1', glow: 'rgba(30, 230, 241, 0.8)', boost: 0.02 },
  { angle: 144, height: 9, radius: 18, color: '#26f0e5', glow: 'rgba(38, 240, 229, 0.85)', boost: 0.14 },
  { angle: 162, height: 7, radius: 18, color: '#23e8ed', glow: 'rgba(35, 232, 237, 0.8)', boost: 0.04 },
  { angle: 180, height: 11, radius: 18, color: '#28f6df', glow: 'rgba(40, 246, 223, 0.9)', boost: 0.18 },
  { angle: 198, height: 8, radius: 18, color: '#25efea', glow: 'rgba(37, 239, 234, 0.85)', boost: 0.06 },
  { angle: 216, height: 10, radius: 18, color: '#1fe4f2', glow: 'rgba(31, 228, 242, 0.85)', boost: 0.12 },
  { angle: 234, height: 7, radius: 18, color: '#18d6fb', glow: 'rgba(24, 214, 251, 0.8)', boost: 0.02 },
  { angle: 252, height: 9, radius: 18, color: '#ff8a3d', glow: 'rgba(255, 138, 61, 0.85)', boost: 0.12 },
  { angle: 270, height: 12, radius: 18, color: '#22f1e6', glow: 'rgba(34, 241, 230, 0.95)', boost: 0.22 },
  { angle: 288, height: 8, radius: 18, color: '#20e8ef', glow: 'rgba(32, 232, 239, 0.85)', boost: 0.06 },
  { angle: 306, height: 10, radius: 18, color: '#28f6df', glow: 'rgba(40, 246, 223, 0.9)', boost: 0.16 },
  { angle: 324, height: 7, radius: 18, color: '#1dddf5', glow: 'rgba(29, 221, 245, 0.8)', boost: 0.04 },
  { angle: 342, height: 9, radius: 18, color: '#25efea', glow: 'rgba(37, 239, 234, 0.85)', boost: 0.1 },
];

const formatPlaybackRate = (value: number) =>
  value.toFixed(2).replace(/\.?0+$/, '');

const formatBytes = (value?: number) => {
  if (!value) {
    return '';
  }

  const mb = value / (1024 * 1024);

  if (mb < 1024) {
    return `${mb.toFixed(mb >= 100 ? 0 : 1)} MB`;
  }

  const gb = mb / 1024;

  return `${gb.toFixed(gb >= 10 ? 1 : 2)} GB`;
};

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

  return 'Compagnon indisponible. Lance Video Playback Helper.vbs.';
};

const createTimeoutSignal = (timeoutMs: number) => {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);

  return { controller, timeoutId };
};

const requestCompanionOptions = async (
  pageUrl: string,
  referer = '',
  timeoutMs = HELPER_FORMAT_TIMEOUT_MS
) => {
  const { controller, timeoutId } = createTimeoutSignal(timeoutMs);
  const params = new URLSearchParams({ url: pageUrl });

  if (referer) {
    params.set('referer', referer);
  }

  const response = await fetch(
    `${YTDLP_HELPER_URL}/formats?${params}`,
    { signal: controller.signal }
  ).finally(() => window.clearTimeout(timeoutId));
  const data = await response.json().catch(() => null);

  if (!response.ok || !data?.ok) {
    throw new Error(
      data?.error || 'Compagnon indisponible. Lance Video Playback Helper.vbs.'
    );
  }

  return data.options || [];
};

const isCompanionInspectionOption = (option: DownloadOption) =>
  option.source === 'companion' &&
  option.pageUrl &&
  option.formatId !== 'direct' &&
  /^html5-(page|blob)-helper$/.test(option.id);

const resolveCompanionInspectionOptions = async (
  options: DownloadOption[],
  timeoutMs = HELPER_FORMAT_TIMEOUT_MS
) => {
  const inspectionOption = options.find(isCompanionInspectionOption);

  if (!inspectionOption?.pageUrl) {
    return options;
  }

  const companionOptions = await requestCompanionOptions(
    inspectionOption.pageUrl,
    inspectionOption.referer,
    timeoutMs
  );

  return companionOptions.length ? companionOptions : options;
};

const requestPageDownloadOptions = (tabID: number): Promise<DownloadOption[]> =>
  new Promise((resolve, reject) => {
    const timeoutId = window.setTimeout(() => {
      reject(new Error('Media detection timed out on this page.'));
    }, CONTENT_OPTIONS_TIMEOUT_MS);

    chrome.tabs.sendMessage(
      tabID,
      { type: GET_DOWNLOAD_OPTIONS, payload: null },
      (response) => {
        window.clearTimeout(timeoutId);

        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message || ''));
          return;
        }

        if (!response?.ok) {
          reject(
            new Error(
              response?.error || 'No downloadable media found on this page.'
            )
          );
          return;
        }

        resolve(response.options || []);
      }
    );
  });

const requestMediaSize = async (option: DownloadOption) => {
  if (option.sizeBytes) {
    return option.sizeBytes;
  }

  const mediaUrl = option.pageUrl || option.url;

  if (!mediaUrl) {
    return 0;
  }

  const params = new URLSearchParams({
    url: mediaUrl,
  });

  if (option.referer) {
    params.set('referer', option.referer);
  }

  const response = await fetch(`${YTDLP_HELPER_URL}/probe?${params}`);
  const data = await response.json().catch(() => null);

  return response.ok && data?.ok ? Number(data.sizeBytes || 0) : 0;
};

const enrichDownloadOptions = async (options: DownloadOption[]) => {
  const enrichedOptions = await Promise.all(
    options.map(async (option) => {
      const shouldProbe =
        !option.sizeBytes &&
        (option.formatId === 'direct' || option.url);

      if (!shouldProbe) {
        return option;
      }

      try {
        const sizeBytes = await requestMediaSize(option);

        return sizeBytes ? { ...option, sizeBytes } : option;
      } catch (error) {
        return option;
      }
    })
  );

  return enrichedOptions;
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
      filename: option.filename,
      referer: option.referer,
      mergeOutputFormat: option.mergeOutputFormat,
    }),
  });
  const data = await response.json().catch(() => null);

  if (!response.ok || !data?.ok) {
    throw new Error(data?.error || 'Failed to start YouTube download.');
  }

  return data.jobId as string;
};

const requestDownloadJobs = async (): Promise<DownloadJob[]> => {
  const response = await fetch(`${YTDLP_HELPER_URL}/jobs`);
  const data = await response.json().catch(() => null);

  if (!response.ok || !data?.ok) {
    return [];
  }

  return data.jobs || [];
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
  const [downloadJobs, setDownloadJobs] = useState<DownloadJob[]>([]);
  const [areDownloadJobsVisible, setAreDownloadJobsVisible] = useState(true);
  const [audioLevels, setAudioLevels] = useState<number[]>(
    LOGO_BARS.map(() => 0)
  );

  const applyToSelectRef = useRef<HTMLSelectElement>(null);

  const sendMediaAttributeData = useCallback(
    async (
      overrides: MediaAttributeOverrides = {},
      closeAfterApply = false,
      saveAsDefault = false
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

      if (saveAsDefault) {
        chrome.storage.sync.set({
          applyTo: targetApplyTo,
          shouldLoop: targetShouldLoop,
          isInTheaterMode: targetTheaterMode,
          playbackRate: targetRate,
          volume: targetVolume,
        });
      }

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
    let isMounted = true;

    const pollAudioLevel = async () => {
      const tabs: any = await getTabsPromise(Tabs.Current);
      const tabId = tabs?.[0]?.id;

      if (!tabId) {
        return;
      }

      chrome.tabs.sendMessage(
        tabId,
        { type: GET_AUDIO_LEVEL, payload: null },
        (response: AudioLevelResponse) => {
          if (!isMounted) {
            return;
          }

          if (chrome.runtime.lastError) {
            setAudioLevels(LOGO_BARS.map(() => 0));
            return;
          }

          if (response?.ok) {
            const nextLevels = response.levels?.length
              ? response.levels
              : LOGO_BARS.map(() => response.level ?? 0);

            setAudioLevels(
              LOGO_BARS.map((_, index) => clamp(nextLevels[index] ?? 0, 0, 1))
            );
            return;
          }

          setAudioLevels(LOGO_BARS.map(() => 0));
        }
      );
    };

    pollAudioLevel();
    const intervalId = window.setInterval(pollAudioLevel, AUDIO_LEVEL_POLL_MS);

    return () => {
      isMounted = false;
      window.clearInterval(intervalId);
    };
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
    let isMounted = true;
    const pollJobs = async () => {
      const jobs = await requestDownloadJobs();

      if (!isMounted) {
        return;
      }

      setDownloadJobs(jobs);
    };
    const interval = window.setInterval(pollJobs, 1000);

    pollJobs();

    return () => {
      isMounted = false;
      window.clearInterval(interval);
    };
  }, []);

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
      false,
      true
    );
  };

  const handleApplyToMediaButtonClick = () => {
    sendMediaAttributeData({}, true, true);
  };

  const handleDownloadButtonClick = async () => {
    setDownloadError('');
    setDownloadOptions([]);
    setAreDownloadJobsVisible(true);
    setIsLoadingDownloadOptions(true);

    try {
      const tabs: any = await getTabsPromise(Tabs.Current);
      const tab = tabs?.[0];
      const tabID = tab?.id;

      if (!tabID) {
        throw new Error('No active tab found.');
      }

      if (isYouTubeUrl(tab.url)) {
        try {
          const options = await requestCompanionOptions(
            tab.url,
            '',
            YOUTUBE_FORMAT_TIMEOUT_MS
          );

          if (options.length) {
            setDownloadOptions(await enrichDownloadOptions(options));
            setIsLoadingDownloadOptions(false);
            return;
          }
        } catch (helperError) {
          throw helperError;
        }
      }

      try {
        const options = await requestPageDownloadOptions(tabID);
        const resolvedOptions = await resolveCompanionInspectionOptions(
          options,
          YOUTUBE_FORMAT_TIMEOUT_MS
        );

        setDownloadOptions(await enrichDownloadOptions(resolvedOptions));
      } catch (pageError) {
        if (!tab.url) {
          throw pageError;
        }

        const helperOptions = await requestCompanionOptions(
          tab.url,
          '',
          HELPER_FORMAT_TIMEOUT_MS
        );

        if (!helperOptions.length) {
          throw pageError;
        }

        setDownloadOptions(await enrichDownloadOptions(helperOptions));
      }

      setIsLoadingDownloadOptions(false);
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

    if (isCompanionInspectionOption(option)) {
      try {
        const options = await requestCompanionOptions(
          option.pageUrl || '',
          option.referer,
          YOUTUBE_FORMAT_TIMEOUT_MS
        );

        if (!options.length) {
          throw new Error('Le compagnon n’a trouvé aucune qualité téléchargeable.');
        }

        setDownloadOptions(await enrichDownloadOptions(options));
      } catch (error) {
        setDownloadError(getHelperError(error));
      } finally {
        setIsStartingDownload(false);
      }
      return;
    }

    if (option.source === 'companion') {
      try {
        const jobId = await requestYouTubeDownload(option);

        setDownloadJobs((jobs) => [
          {
            id: jobId,
            label: option.label,
            status: 'starting',
            percent: 0,
            message: 'Download started...',
          },
          ...jobs.filter((job) => job.id !== jobId),
        ]);
        setAreDownloadJobsVisible(true);
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

      setDownloadJobs((jobs) => [
        {
          id: `browser-download-${Date.now()}`,
          label: option.label,
          status: 'complete',
          percent: 100,
          message: 'Download started in Chrome.',
        },
        ...jobs,
      ]);
    });
  };

  return (
    <div className="App">
      <header className="App-header">
        <div className="u-flex u-ai-center">
          <div className="App-logo" aria-hidden="true">
            <img src={logoBase || logo} className="App-logo-base" alt="" />
            <div className="App-logo-bars">
              {LOGO_BARS.map((bar, index) => (
                <span
                  className="App-logo-bar"
                  key={index}
                  style={
                    {
                      '--bar-index': index,
                      '--bar-angle': `${bar.angle}deg`,
                      '--bar-height': `${bar.height}px`,
                      '--bar-radius': `${bar.radius}px`,
                      '--bar-offset': `${bar.height / -2}px`,
                      '--bar-color': bar.color,
                      '--bar-glow': bar.glow,
                      '--bar-boost': bar.boost,
                      '--bar-level': audioLevels[index] ?? 0,
                      '--bar-hue': getLogoBarHue(audioLevels[index] ?? 0),
                      '--bar-lightness': `${getLogoBarLightness(
                        audioLevels[index] ?? 0
                      )}%`,
                      '--bar-glow-alpha': getLogoBarGlow(
                        audioLevels[index] ?? 0
                      ),
                    } as React.CSSProperties
                  }
                >
                  <i />
                </span>
              ))}
            </div>
          </div>
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
                onClick={handleDownloadButtonClick}
                disabled={isLoadingDownloadOptions}
              >
                {isLoadingDownloadOptions ? 'Loading...' : 'Download Media'}
              </button>
            </div>

            {!areDownloadJobsVisible && !!downloadJobs.length && (
              <button
                className="App-inline-link u-margin-top-15"
                type="button"
                onClick={() => setAreDownloadJobsVisible(true)}
              >
                Show downloads ({downloadJobs.length})
              </button>
            )}

            {!!downloadError && (
              <div className="App-download-error u-margin-top-15">
                {downloadError}
              </div>
            )}

            {!!downloadOptions.length && (
              <div className="App-download-options u-margin-top-15">
                <div className="App-panel-header">
                  <strong>Available formats</strong>
                  <button
                    type="button"
                    onClick={() => setDownloadOptions([])}
                  >
                    Hide
                  </button>
                </div>
                {downloadOptions.map((option) => (
                  <button
                    key={`${option.id}-${option.url || option.formatId}`}
                    className="App-download-option"
                    type="button"
                    title={option.detail}
                    disabled={isStartingDownload}
                    onClick={() => handleDownloadOptionClick(option)}
                  >
                    <span>{option.label}</span>
                    <small>
                      {option.detail}
                      {option.sizeBytes
                        ? ` - ${formatBytes(option.sizeBytes)}`
                        : ''}
                      {option.includesAllAudioTracks
                        ? ' - all audio languages'
                        : ''}
                    </small>
                  </button>
                ))}
              </div>
            )}

            {areDownloadJobsVisible && !!downloadJobs.length && (
              <div className="App-download-status u-margin-top-15">
                <div className="App-panel-header">
                  <strong>Downloads</strong>
                  <button
                    type="button"
                    onClick={() => setAreDownloadJobsVisible(false)}
                  >
                    Hide
                  </button>
                </div>
                {downloadJobs.slice(0, 4).map((downloadJob) => (
                  <div
                    className="App-download-job"
                    key={downloadJob.id}
                  >
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
                ))}
              </div>
            )}

            {!!downloadOptions.some((option) => option.audioTracks?.length) && (
              <div className="App-audio-tracks u-margin-top-15">
                <strong>Audio Tracks</strong>
                {(
                  downloadOptions.find((option) => option.audioTracks?.length)
                    ?.audioTracks || []
                ).map((track) => (
                  <div
                    className="App-audio-track"
                    key={`${track.formatId}-${track.language}`}
                  >
                    <span>{track.label}</span>
                    <small>{track.language}</small>
                  </div>
                ))}
              </div>
            )}

            <div className="u-flex u-margin-top-15">
              <details className="App-shortcut-details">
                <summary>Shortcuts</summary>
                {Object.keys(shortcuts).map((shortcut, i) => (
                  <div
                    className="App-shortcut-row"
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
