import { getDataFromSyncStoragePromise } from '../../../helpers';

export const setMediaLoop = async (
  shouldLoop?: boolean,
  targetMedia?: HTMLMediaElement
): Promise<any> => {
  // for media that are loading in asynchronously
  // we need to grab shouldLoop from sync storage
  // and recursively call `setMediaLoop`
  if (shouldLoop === undefined) {
    const data: any = await getDataFromSyncStoragePromise();

    return setMediaLoop(data.shouldLoop, targetMedia);
  } else {
    if (targetMedia) {
      return _setMediaLoop(shouldLoop, targetMedia);
    }
    const videos = Array.from(document.getElementsByTagName('video'));
    const audios = Array.from(document.getElementsByTagName('audio'));
    const medias = [...videos, ...audios];

    for (let i = 0; i < medias.length; i++) {
      const media = medias[i];
      _setMediaLoop(shouldLoop, media);
    }
  }
};

let shouldLoopMessageBannerTimerID: number | null = null;

const updateShouldLoopMessageBanner = (shouldLoop: boolean) => {
  if (shouldLoopMessageBannerTimerID) {
    clearTimeout(shouldLoopMessageBannerTimerID);
  }
  const shouldLoopMessageBanner = document.getElementById(
    'js-shouldLoopMessageBanner'
  );

  shouldLoopMessageBanner!.innerText = `Media looping set to ${shouldLoop}`;

  shouldLoopMessageBannerTimerID = window.setTimeout(() => {
    shouldLoopMessageBanner!.innerText = '';
  }, 3000);
};

const _setMediaLoop = (shouldLoop: boolean, media: HTMLMediaElement) => {
  if (media.loop !== shouldLoop) {
    media.loop = shouldLoop;
    updateShouldLoopMessageBanner(media.loop);
  }
};
