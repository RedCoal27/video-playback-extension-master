export const setStorageFromDOMState = (): void => {
  const video = document.querySelector('video');
  const audio = document.querySelector('audio');
  const media = video || audio;

  const hasVideoInTheaterMode = document.querySelector('.TheaterModeVideo');

  chrome.storage.sync.set({
    shouldLoop: media?.loop || false,
    isInTheaterMode: hasVideoInTheaterMode,
  });
};
