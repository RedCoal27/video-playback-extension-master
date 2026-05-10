import { getDataFromSyncStoragePromise } from '../../../helpers';

export const setMediaPlaybackRate = async (
  playbackRate?: number,
  targetMedia?: HTMLMediaElement
): Promise<any> => {
  // for media that are loading in asynchronously
  // we need to grab playbackRate from sync storage
  // and recursively call `setMediaPlaybackRate`
  if (!playbackRate) {
    const data: any = await getDataFromSyncStoragePromise();

    return setMediaPlaybackRate(data.playbackRate || 1, targetMedia);
  } else {
    if (targetMedia) {
      return _setMediaPlaybackRate(playbackRate, targetMedia);
    }

    const videos = Array.from(document.getElementsByTagName('video'));
    const audios = Array.from(document.getElementsByTagName('audio'));
    const medias = [...videos, ...audios];

    for (let i = 0; i < medias.length; i++) {
      const media = medias[i];
      _setMediaPlaybackRate(playbackRate, media);
    }
  }
};

const _setMediaPlaybackRate = (
  playbackRate: number,
  media: HTMLMediaElement
) => {
  if (media.playbackRate !== playbackRate) {
    media.playbackRate = playbackRate as number;
  }
};
