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

type FrameDetails = {
  tabId: number;
  frameId: number;
  url?: string;
};

const injectedChildFrameUrls = new Map<string, string>();

const getFrameKey = (tabId: number, frameId: number) => `${tabId}:${frameId}`;

const isScriptableFrameUrl = (url?: string) => {
  return !!url && /^https?:\/\//i.test(url);
};

const forgetFrameInjection = (tabId: number, frameId: number) => {
  injectedChildFrameUrls.delete(getFrameKey(tabId, frameId));
};

const insertContentStyles = (tabId: number, frameId: number) => {
  return new Promise<void>((resolve) => {
    const scripting = (chrome as any).scripting;

    if (!scripting?.insertCSS) {
      resolve();
      return;
    }

    scripting.insertCSS(
      {
        target: { tabId, frameIds: [frameId] },
        files: ['content.styles.css'],
      },
      () => {
        // Ignore CSS injection failures; the controls still work without the
        // banner styles, and logging here would be noisy on protected frames.
        if (chrome.runtime.lastError) {
          resolve();
          return;
        }

        resolve();
      }
    );
  });
};

const executeContentScript = (tabId: number, frameId: number) => {
  return new Promise<void>((resolve, reject) => {
    const scripting = (chrome as any).scripting;

    if (!scripting?.executeScript) {
      resolve();
      return;
    }

    scripting.executeScript(
      {
        target: { tabId, frameIds: [frameId] },
        files: ['contentScript.bundle.js'],
      },
      () => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
          return;
        }

        resolve();
      }
    );
  });
};

const injectContentScriptIntoFrame = async (frame: FrameDetails) => {
  const { tabId, frameId, url } = frame;

  // The main frame is still handled by manifest content_scripts. Child frames
  // are injected programmatically so we can skip about:blank/about:srcdoc and
  // other sandboxed/protected frames before Chrome tries to execute anything.
  if (frameId === 0 || !isScriptableFrameUrl(url)) {
    return;
  }

  const frameKey = getFrameKey(tabId, frameId);

  if (injectedChildFrameUrls.get(frameKey) === url) {
    return;
  }

  try {
    await insertContentStyles(tabId, frameId);
    await executeContentScript(tabId, frameId);
    injectedChildFrameUrls.set(frameKey, url || '');
  } catch (error) {
    // Some frames can still reject extension script execution due to browser or
    // site policy. Silently ignore them instead of spamming the console.
  }
};

const injectContentScriptsIntoTabFrames = (tabId: number) => {
  return new Promise<void>((resolve) => {
    const webNavigation = (chrome as any).webNavigation;

    if (!webNavigation?.getAllFrames) {
      resolve();
      return;
    }

    webNavigation.getAllFrames({ tabId }, (frames: FrameDetails[] | undefined) => {
      if (chrome.runtime.lastError || !frames?.length) {
        resolve();
        return;
      }

      Promise.all(
        frames.map((frame) => injectContentScriptIntoFrame(frame).catch(() => {}))
      ).then(() => resolve());
    });
  });
};

const setupChildFrameInjection = () => {
  const webNavigation = (chrome as any).webNavigation;

  webNavigation?.onDOMContentLoaded?.addListener((details: FrameDetails) => {
    if (details.frameId === 0) {
      injectContentScriptsIntoTabFrames(details.tabId);
      return;
    }

    forgetFrameInjection(details.tabId, details.frameId);
    injectContentScriptIntoFrame(details);
  });

  chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
    if (changeInfo.status === 'complete') {
      injectContentScriptsIntoTabFrames(tabId);
    }
  });

  chrome.tabs.onRemoved.addListener((tabId) => {
    Array.from(injectedChildFrameUrls.keys()).forEach((key) => {
      if (key.startsWith(`${tabId}:`)) {
        injectedChildFrameUrls.delete(key);
      }
    });
  });
};

setupChildFrameInjection();

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
