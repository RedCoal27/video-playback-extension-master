import { getDataFromSyncStoragePromise } from '../../../helpers';

type BoostedMedia = {
  gainNode: GainNode;
  audioContext: AudioContext;
};

const boostedMedias = new WeakMap<HTMLMediaElement, BoostedMedia>();

const normalizeVolume = (volume: number | string | undefined): number => {
  const parsedVolume = parseFloat(`${volume ?? 1}`);

  if (Number.isNaN(parsedVolume)) {
    return 1;
  }

  return Math.min(Math.max(parsedVolume, 0), 5);
};

export const setMediaVolume = async (
  volume?: number,
  targetMedia?: HTMLMediaElement
): Promise<any> => {
  if (typeof volume === 'undefined') {
    const data: any = await getDataFromSyncStoragePromise();

    return setMediaVolume(normalizeVolume(data.volume), targetMedia);
  }

  const targetVolume = normalizeVolume(volume);

  if (targetMedia) {
    return _setMediaVolume(targetVolume, targetMedia);
  }

  const videos = Array.from(document.getElementsByTagName('video'));
  const audios = Array.from(document.getElementsByTagName('audio'));
  const medias = [...videos, ...audios];

  for (let i = 0; i < medias.length; i++) {
    const media = medias[i];
    _setMediaVolume(targetVolume, media);
  }
};

const _setMediaVolume = (volume: number, media: HTMLMediaElement) => {
  const nativeVolume = Math.min(volume, 1);

  if (media.volume !== nativeVolume) {
    media.volume = nativeVolume;
  }

  if (volume <= 1) {
    const boostedMedia = boostedMedias.get(media);

    if (boostedMedia) {
      boostedMedia.gainNode.gain.value = 1;
    }

    return;
  }

  const boostedMedia = getBoostedMedia(media);

  if (!boostedMedia) {
    return;
  }

  boostedMedia.gainNode.gain.value = volume;

  if (boostedMedia.audioContext.state === 'suspended') {
    boostedMedia.audioContext.resume();
  }
};

const getBoostedMedia = (media: HTMLMediaElement): BoostedMedia | null => {
  const existingBoostedMedia = boostedMedias.get(media);

  if (existingBoostedMedia) {
    return existingBoostedMedia;
  }

  const AudioContextConstructor =
    window.AudioContext || (window as any).webkitAudioContext;

  if (!AudioContextConstructor) {
    return null;
  }

  try {
    const audioContext = new AudioContextConstructor();
    const source = audioContext.createMediaElementSource(media);
    const gainNode = audioContext.createGain();
    const boostedMedia = { audioContext, gainNode };

    source.connect(gainNode);
    gainNode.connect(audioContext.destination);
    boostedMedias.set(media, boostedMedia);

    media.addEventListener('play', () => {
      if (audioContext.state === 'suspended') {
        audioContext.resume();
      }
    });

    return boostedMedia;
  } catch (error) {
    console.error('Error trying to boost media volume: ', error);

    return null;
  }
};
