import {
  setMediaPlaybackRate,
  setMediaVolume,
  setMediaLoop,
  setVideoTheaterMode,
  setCurrentTime,
  setStorageFromDOMState,
  downloadMedia,
  getDownloadOptions,
} from './modules';
import { Message, PlayerState } from '../../types';
import {
  SET_PLAYBACK_RATE,
  SET_MEDIA_ATTRIBUTES,
  SKIP_BACKWARD,
  SKIP_FORWARD,
  PLAY_PLAYER_ACTION,
  PAUSE_PLAYER_ACTION,
  RESTART_PLAYER_ACTION,
  DOWNLOAD_MEDIA,
  GET_DOWNLOAD_OPTIONS,
  DISABLE_EXTENSION,
  ENABLE_EXTENSION,
  SHORTCUT_DECREASE_PLAYBACK_RATE,
  SHORTCUT_INCREASE_PLAYBACK_RATE,
  SHORTCUT_SKIP_BACKWARD,
  SHORTCUT_SKIP_FORWARD,
  SHORTCUT_PLAY_PLAYER,
  SHORTCUT_PAUSE_PLAYER,
  SHORTCUT_LOOP,
  SHORTCUT_THEATER_MODE,
  SHORTCUT_RESET_PLAYBACK_RATE,
  SHORTCUT_RESTART_PLAYER,
  DEFAULT_SHORTCUT_KEYS,
  VIDEO_PLAYBACK_EXTENSION,
} from '../../constants';
import { getDataFromSyncStoragePromise } from '../../helpers';
import { playPauseMedia } from './modules/playPauseMedia';

console.log('Video Playback Extension content script loaded');

let isContentEnabled = false;
let hasRuntimeMessageListener = false;

type ActiveMediaAttributes = {
  playbackRate?: number;
  volume?: number;
  shouldLoop?: boolean;
  isInTheaterMode?: boolean;
};

let activeMediaAttributes: ActiveMediaAttributes = {};

const clampPlaybackRate = (value: number) => Math.min(Math.max(value, 0.1), 16);

const getCurrentPlaybackRate = (storedPlaybackRate: number | string | undefined) => {
  const parsedPlaybackRate = Number(
    activeMediaAttributes.playbackRate ?? storedPlaybackRate ?? 1
  );

  if (Number.isNaN(parsedPlaybackRate)) {
    return 1;
  }

  return parsedPlaybackRate;
};

const applyTemporaryPlaybackRate = (playbackRate: number) => {
  activeMediaAttributes.playbackRate = playbackRate;
  setMediaPlaybackRate(playbackRate);
};

const changePlaybackRateBy = async (
  delta: number,
  storedPlaybackRate?: number | string
) => {
  let currentPlaybackRate = storedPlaybackRate;

  if (typeof currentPlaybackRate === 'undefined') {
    const data: any = await getDataFromSyncStoragePromise();
    currentPlaybackRate = data.playbackRate;
  }

  applyTemporaryPlaybackRate(
    clampPlaybackRate(getCurrentPlaybackRate(currentPlaybackRate) + delta)
  );
};

const applyMediaAttributesToMedia = (media: HTMLMediaElement) => {
  setMediaPlaybackRate(activeMediaAttributes.playbackRate, media);
  setMediaVolume(activeMediaAttributes.volume, media);
  setMediaLoop(activeMediaAttributes.shouldLoop, media);
};

const observer = new MutationObserver((mutations) => {
  for (let i = 0; i < mutations.length; i++) {
    const mutation = mutations[i];
    for (let j = 0; j < mutation?.addedNodes?.length; j++) {
      const addedNode = mutation?.addedNodes[j];

      if (addedNode.nodeName === 'VIDEO' || addedNode.nodeName === 'AUDIO') {
        applyMediaAttributesToMedia(addedNode as HTMLMediaElement);
      }

      // handle nested media
      // it might be text node or comment node which don't have getElementsByTagName
      const hasNestedVideos =
        (<HTMLElement>addedNode).getElementsByTagName &&
        (<HTMLElement>addedNode).getElementsByTagName('video').length;

      const hasNestedAudio =
        (<HTMLElement>addedNode).getElementsByTagName &&
        (<HTMLElement>addedNode).getElementsByTagName('audio').length;

      if (hasNestedVideos || hasNestedAudio) {
        const nestedVideos = Array.from(
          (<HTMLElement>addedNode).getElementsByTagName('video')
        );
        const nestedAudios = Array.from(
          (<HTMLElement>addedNode).getElementsByTagName('audio')
        );

        const nestedMedias = [...nestedVideos, ...nestedAudios];
        for (let k = 0; k < nestedMedias.length; k++) {
          const nestedMedia = nestedMedias[k];
          applyMediaAttributesToMedia(nestedMedia);
        }
      }
    }
  }
});

const init = async () => {
  const data: any = await getDataFromSyncStoragePromise();

  addRuntimeMessageListener();

  if (data.isEnabled !== false) {
    enableContentScript(data);
  }
};

const enableContentScript = async (storageData?: any) => {
  if (isContentEnabled) {
    return;
  }

  isContentEnabled = true;

  const data = storageData || (await getDataFromSyncStoragePromise());
  const messageBannerContainer = getOrCreateMessageBannerContainer();

  appendBannerListItemToContainer(
    'js-playbackRateMessageBanner',
    messageBannerContainer
  );
  appendBannerListItemToContainer(
    'js-shouldLoopMessageBanner',
    messageBannerContainer
  );
  appendBannerListItemToContainer(
    'js-isInTheaterModeMessageBanner',
    messageBannerContainer
  );
  appendBannerListItemToContainer(
    'js-skipIntervalMessageBanner',
    messageBannerContainer
  );
  appendBannerListItemToContainer(
    'js-playPausePlayerActionMessageBanner',
    messageBannerContainer
  );

  setMediaPlaybackRate(data.playbackRate);
  setMediaVolume(data.volume);
  setMediaLoop(data.shouldLoop);
  setVideoTheaterMode(data.isInTheaterMode);

  document.addEventListener('ratechange', handleRateChange, true);
  document.addEventListener('play', handlePlayOrSeek, true);
  document.addEventListener('seeked', handlePlayOrSeek, true);
  document.addEventListener('keydown', handleKeydown, true);
  window.addEventListener('focus', handleWindowFocus, true);

  observer.observe(document.body, { childList: true, subtree: true });
};

const disableContentScript = () => {
  if (!isContentEnabled) {
    return;
  }

  isContentEnabled = false;

  document.removeEventListener('ratechange', handleRateChange, true);
  document.removeEventListener('play', handlePlayOrSeek, true);
  document.removeEventListener('seeked', handlePlayOrSeek, true);
  document.removeEventListener('keydown', handleKeydown, true);
  window.removeEventListener('focus', handleWindowFocus, true);
  observer.disconnect();
};

const getOrCreateMessageBannerContainer = () => {
  const existingContainer = document.getElementById(
    'js-messageBannerContainer'
  ) as HTMLUListElement | null;

  if (existingContainer) {
    return existingContainer;
  }

  const messageBannerContainer = document.createElement('ul');
  messageBannerContainer.setAttribute('id', 'js-messageBannerContainer');
  messageBannerContainer.className = 'MessageBannerContainer';
  document.body.prepend(messageBannerContainer);

  return messageBannerContainer;
};

const appendBannerListItemToContainer = (
  bannerListItemID: string,
  container: HTMLUListElement
) => {
  if (document.getElementById(bannerListItemID)) {
    return;
  }

  const banner = document.createElement('li');
  banner.setAttribute('id', bannerListItemID);
  banner.className = 'MessageBanner';
  container.append(banner);
};

let playbackRateMessageBannerTimerID: number | null = null;

const handleRateChange = (e: Event) => {
  if (playbackRateMessageBannerTimerID) {
    clearTimeout(playbackRateMessageBannerTimerID);
  }
  const playbackRateMessageBanner = document.getElementById(
    'js-playbackRateMessageBanner'
  );

  playbackRateMessageBanner!.innerText = `Playback rate changed to ${(e.target as HTMLMediaElement).playbackRate
    }`;

  playbackRateMessageBannerTimerID = window.setTimeout(() => {
    playbackRateMessageBanner!.innerText = '';
  }, 3000);
};

const handlePlayOrSeek = async (e: Event) => {
  const data: any = await getDataFromSyncStoragePromise();
  (e.target as HTMLMediaElement).playbackRate =
    activeMediaAttributes.playbackRate ?? data.playbackRate ?? 1;
  setMediaVolume(
    activeMediaAttributes.volume ?? data.volume,
    e.target as HTMLMediaElement
  );
};

const isNetflix = () => {
  return window.location.href.includes('netflix.com');
};

const handleKeydown = async (e: KeyboardEvent) => {
  const keyCode = e.key;

  let {
    isEnabled,
    isInTheaterMode,
    playbackRate,
    skipInterval,
    shouldLoop,
    shortcuts,
  }: any = await getDataFromSyncStoragePromise();

  // if cant find from storage, set to default shortcut keys
  if (!shortcuts) {
    shortcuts = DEFAULT_SHORTCUT_KEYS;
  }

  // swap key and value
  // BEFORE:
  // {
  //    "decrease-playback-rate": s,
  //    "increase-playback-rate": w,
  //    "reset-playback-rate": e,
  //    "skip-forward": d,
  //    "skip-backward": a,
  //    "restart-player": r,
  //    "play-player": p,
  //    "pause-player": o,
  //    loop: l,
  //    "theater-mode": t,
  // };
  //
  // AFTER
  // {
  //    s: "decrease-playback-rate",
  //    w: "increase-playback-rate",
  //    e: "reset-playback-rate",
  //    d: "skip-forward",
  //    a: "skip-backward",
  //    r: "restart-player",
  //    p: "play-player",
  //    o: "pause-player",
  //    l: loop,
  //    t: "theater-mode",
  // };

  const shortcutMap = Object.keys(shortcuts).reduce(
    (accumulator: Record<string, string>, curKey) => {
      accumulator[shortcuts[curKey]] = curKey;
      return accumulator;
    },
    {}
  );

  // Ignore if following modifier is active.
  if (
    !e.getModifierState ||
    e.getModifierState('Alt') ||
    e.getModifierState('Control') ||
    e.getModifierState('Fn') ||
    e.getModifierState('Meta') ||
    e.getModifierState('Hyper') ||
    e.getModifierState('OS')
  ) {
    return false;
  }

  // Ignore keydown event if typing in an input box
  if (
    e.target &&
    ((e.target as any).nodeName === 'INPUT' ||
      (e.target as any).nodeName === 'TEXTAREA' ||
      (e.target as any).isContentEditable)
  ) {
    return false;
  }

  if (shortcutMap[keyCode]) {
    // early exit if disabled
    if (isEnabled === false) {
      return false;
    }

    switch (shortcutMap[keyCode]) {
      case SHORTCUT_DECREASE_PLAYBACK_RATE:
        await changePlaybackRateBy(-0.25, playbackRate);
        break;
      case SHORTCUT_INCREASE_PLAYBACK_RATE:
        await changePlaybackRateBy(0.25, playbackRate);
        break;
      case SHORTCUT_RESET_PLAYBACK_RATE:
        applyTemporaryPlaybackRate(1);
        break;
      case SHORTCUT_SKIP_FORWARD:
        const skipForwardInterval = parseFloat(skipInterval || 30);
        if (isNetflix()) {
          window.postMessage(
            {
              source: VIDEO_PLAYBACK_EXTENSION,
              type: SHORTCUT_SKIP_FORWARD,
              skipInterval: skipForwardInterval,
            },
            '*'
          );
        } else {
          setCurrentTime(skipForwardInterval);
        }
        break;
      case SHORTCUT_SKIP_BACKWARD:
        const skipBackwardInterval = parseFloat(skipInterval || 30) * -1;
        if (isNetflix()) {
          window.postMessage(
            {
              source: VIDEO_PLAYBACK_EXTENSION,
              type: SHORTCUT_SKIP_BACKWARD,
              skipInterval: skipBackwardInterval,
            },
            '*'
          );
        } else {
          setCurrentTime(skipBackwardInterval);
        }
        break;
      case SHORTCUT_RESTART_PLAYER:
        if (isNetflix()) {
          window.postMessage(
            {
              source: VIDEO_PLAYBACK_EXTENSION,
              type: SHORTCUT_RESTART_PLAYER,
              skipInterval: 0,
            },
            '*'
          );
        } else {
          setCurrentTime(0);
        }
        break;
      case SHORTCUT_PLAY_PLAYER:
        playPauseMedia(PlayerState.Play);
        break;
      case SHORTCUT_PAUSE_PLAYER:
        playPauseMedia(PlayerState.Pause);
        break;
      case SHORTCUT_LOOP:
        const newShouldLoop = !shouldLoop;
        chrome.storage.sync.set({ shouldLoop: newShouldLoop });
        setMediaLoop(newShouldLoop);
        break;
      case SHORTCUT_THEATER_MODE:
        const newTheaterMode = !isInTheaterMode;
        chrome.storage.sync.set({ isInTheaterMode: newTheaterMode });
        setVideoTheaterMode(newTheaterMode);
        break;
      default:
        break;
    }
  }

  return false;
};

const handleWindowFocus = () => {
  setStorageFromDOMState();
};

const handleMessage = (
  message: Message,
  sender: any,
  sendResponse: (response?: any) => void
) => {
  if (message.type === GET_DOWNLOAD_OPTIONS) {
    getDownloadOptions()
      .then((options) => {
        if (options.length) {
          sendResponse({ ok: true, options });
        }
      })
      .catch((error) => {
        if (window.top === window) {
          sendResponse({
            ok: false,
            error: error?.message || 'Failed to get download options.',
          });
        }
      });

    return true;
  }

  switch (message.type) {
    case ENABLE_EXTENSION:
      enableContentScript();
      break;
    case DISABLE_EXTENSION:
      disableContentScript();
      break;
    case SET_PLAYBACK_RATE:
      applyTemporaryPlaybackRate(message.payload.targetRate);
      break;
    case SHORTCUT_DECREASE_PLAYBACK_RATE:
      changePlaybackRateBy(-0.25);
      break;
    case SHORTCUT_INCREASE_PLAYBACK_RATE:
      changePlaybackRateBy(0.25);
      break;
    case SHORTCUT_RESET_PLAYBACK_RATE:
      applyTemporaryPlaybackRate(1);
      break;
    case SKIP_FORWARD:
      const skipForwardInterval = parseFloat(message.payload.skipInterval);
      if (isNetflix()) {
        window.postMessage(
          {
            source: VIDEO_PLAYBACK_EXTENSION,
            type: SKIP_FORWARD,
            skipInterval: skipForwardInterval,
          },
          '*'
        );
      } else {
        setCurrentTime(skipForwardInterval);
      }
      break;
    case SKIP_BACKWARD:
      const skipBackwardInterval =
        parseFloat(message.payload.skipInterval) * -1;
      if (isNetflix()) {
        window.postMessage(
          {
            source: VIDEO_PLAYBACK_EXTENSION,
            type: SKIP_BACKWARD,
            skipInterval: skipBackwardInterval,
          },
          '*'
        );
      } else {
        setCurrentTime(skipBackwardInterval);
      }
      break;
    case SET_MEDIA_ATTRIBUTES:
      activeMediaAttributes = {
        playbackRate: message.payload.targetRate,
        volume: message.payload.volume,
        shouldLoop: message.payload.shouldLoop,
        isInTheaterMode: message.payload.isInTheaterMode,
      };
      setMediaPlaybackRate(message.payload.targetRate);
      setMediaVolume(message.payload.volume);
      setMediaLoop(message.payload.shouldLoop);
      setVideoTheaterMode(message.payload.isInTheaterMode);
      break;
    case PLAY_PLAYER_ACTION:
      playPauseMedia(PlayerState.Play);
      break;
    case PAUSE_PLAYER_ACTION:
      playPauseMedia(PlayerState.Pause);
      break;
    case RESTART_PLAYER_ACTION:
      if (isNetflix()) {
        window.postMessage(
          {
            source: VIDEO_PLAYBACK_EXTENSION,
            type: RESTART_PLAYER_ACTION,
            skipInterval: 0,
          },
          '*'
        );
      } else {
        setCurrentTime(0);
      }
      break;
    case DOWNLOAD_MEDIA:
      downloadMedia().catch((error) => {
        console.error('Failed to download media: ', error);
      });
      break;
    default:
      break;
  }

  return false;
};

const addRuntimeMessageListener = () => {
  if (hasRuntimeMessageListener) {
    return;
  }

  hasRuntimeMessageListener = true;
  chrome.runtime.onMessage.addListener(handleMessage);
};

// inject special script for netflix
if (isNetflix()) {
  const scriptElement = document.createElement('script');
  scriptElement.src = chrome.runtime.getURL('netflix.bundle.js');
  (document.head || document.documentElement).appendChild(scriptElement);
  scriptElement.onload = function () {
    scriptElement?.parentNode?.removeChild(scriptElement);
  };
}

init();
