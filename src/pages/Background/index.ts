import {
  SHORTCUT_DECREASE_PLAYBACK_RATE,
  SHORTCUT_INCREASE_PLAYBACK_RATE,
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
      const decreasedPlaybackRateMessage = {
        type: SHORTCUT_DECREASE_PLAYBACK_RATE,
        payload: null,
      };

      sendMessageToTabs(
        tabs,
        decreasedPlaybackRateMessage,
        isApplyingToAllTabs
      );
      break;
    case SHORTCUT_INCREASE_PLAYBACK_RATE:
      const increasedPlaybackRateMessage = {
        type: SHORTCUT_INCREASE_PLAYBACK_RATE,
        payload: null,
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

chrome.runtime.onMessage.addListener((message: any, sender, sendResponse) => {
  if (message?.type !== REQUEST_DOWNLOAD_URL) {
    return;
  }

  const url = message?.payload?.url;
  const filename = message?.payload?.filename;

  if (!url) {
    return;
  }

  chrome.downloads.download(
    {
      url,
      filename,
      saveAs: false,
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

  return true;
});
