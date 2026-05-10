export const sendMessageToTab = (tabID: number, message: Object) => {
  try {
    chrome.tabs.sendMessage(tabID, message, () => {
      // Some tabs do not have this extension's content script. Reading
      // lastError prevents Chrome from logging a noisy unchecked error.
      if (chrome.runtime.lastError) {
        return;
      }
    });
  } catch (error) {
    return false;
  }
};
