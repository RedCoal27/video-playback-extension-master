import {
  SHORTCUT_DECREASE_PLAYBACK_RATE,
  SHORTCUT_INCREASE_PLAYBACK_RATE,
  SET_PLAYBACK_RATE,
  SHORTCUT_SKIP_FORWARD,
  SHORTCUT_SKIP_BACKWARD,
  SKIP_FORWARD,
  SKIP_BACKWARD,
  REQUEST_DOWNLOAD_URL,
} from '../../constants';
import {
  getDataFromSyncStoragePromise,
  getTabsPromise,
  sendMessageToTabs,
} from '../../helpers';

// need to import these so that theyre included in build bundle
import '../../assets/img/icon34.png';
import '../../assets/img/icon34-inactive.png';
import '../../assets/img/icon128.png';

const handleCommand = async (command: string) => {
  const {
    isEnabled,
    applyTo,
    playbackRate,
    skipInterval,
  }: any = await getDataFromSyncStoragePromise();
  const tabs: any = await getTabsPromise(applyTo);

  const isApplyingToAllTabs = applyTo === 'all';

  // early exit if disabled
  if (isEnabled === false) {
    return false;
  }

  switch (command) {
    case SHORTCUT_DECREASE_PLAYBACK_RATE:
      const decreasedPlaybackRate = parseFloat(playbackRate) - 0.25;
      chrome.storage.sync.set({ playbackRate: decreasedPlaybackRate });

      const decreasedPlaybackRateMessage = {
        type: SET_PLAYBACK_RATE,
        payload: { targetRate: decreasedPlaybackRate },
      };

      sendMessageToTabs(
        tabs,
        decreasedPlaybackRateMessage,
        isApplyingToAllTabs
      );
      break;
    case SHORTCUT_INCREASE_PLAYBACK_RATE:
      const increasedPlaybackRate = parseFloat(playbackRate) + 0.25;
      chrome.storage.sync.set({ playbackRate: increasedPlaybackRate });

      const increasedPlaybackRateMessage = {
        type: SET_PLAYBACK_RATE,
        payload: { targetRate: increasedPlaybackRate },
      };

      sendMessageToTabs(
        tabs,
        increasedPlaybackRateMessage,
        isApplyingToAllTabs
      );

      break;
    case SHORTCUT_SKIP_FORWARD:
      const skipForwardMessage = {
        type: SKIP_FORWARD,
        payload: { skipInterval: skipInterval || 30 },
      };
      sendMessageToTabs(tabs, skipForwardMessage, isApplyingToAllTabs);
      break;
    case SHORTCUT_SKIP_BACKWARD:
      const skipBackwardMessage = {
        type: SKIP_BACKWARD,
        payload: { skipInterval: skipInterval || 30 },
      };
      sendMessageToTabs(tabs, skipBackwardMessage, isApplyingToAllTabs);
      break;
    default:
      break;
  }
};

chrome.commands.onCommand.addListener(handleCommand);

const validateDownloadUrl = async (url: string) => {
  const response = await fetch(url, {
    method: 'GET',
    credentials: 'include',
    headers: {
      Range: 'bytes=0-0',
    },
  });
  const contentType = response.headers.get('content-type') || '';

  if (!response.ok) {
    throw new Error(`Download URL refused the request (${response.status}).`);
  }

  if (
    contentType &&
    !contentType.includes('video') &&
    !contentType.includes('audio') &&
    !contentType.includes('octet-stream')
  ) {
    throw new Error(`Download URL returned ${contentType}, not media.`);
  }
};

chrome.runtime.onMessage.addListener((message: any, sender, sendResponse) => {
  if (message?.type !== REQUEST_DOWNLOAD_URL) {
    return;
  }

  const url = message?.payload?.url;
  const filename = message?.payload?.filename;

  if (!url) {
    return;
  }

  validateDownloadUrl(url)
    .then(() => {
      chrome.downloads.download(
        {
          url,
          filename,
          saveAs: false,
          headers: [
            {
              name: 'Referer',
              value: 'https://www.youtube.com/',
            },
            {
              name: 'Origin',
              value: 'https://www.youtube.com',
            },
          ],
        },
        () => {
          if (chrome.runtime.lastError) {
            sendResponse({
              ok: false,
              error: chrome.runtime.lastError.message,
            });
            return;
          }

          sendResponse({ ok: true });
        }
      );
    })
    .catch((error) => {
      sendResponse({
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : 'Failed to validate download URL.',
      });
    });

  return true;
});
