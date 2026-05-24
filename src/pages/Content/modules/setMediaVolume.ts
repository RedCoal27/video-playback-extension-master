import { getDataFromSyncStoragePromise } from '../../../helpers';

type BoostedMedia = {
  gainNode?: GainNode;
  audioContext?: AudioContext;
  baselineVolume: number;
  lastFactor: number;
};

const mediaVolumeStates = new WeakMap<HTMLMediaElement, BoostedMedia>();

const isSafeToBoostVolume = (media: HTMLMediaElement): boolean => {
  const mediaUrl = media.currentSrc || media.src;

  if (!mediaUrl) {
    return false;
  }

  try {
    const url = new URL(mediaUrl, window.location.href);

    return (
      url.protocol === 'blob:' ||
      url.protocol === 'data:' ||
      url.origin === window.location.origin
    );
  } catch (error) {
    return false;
  }
};

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
  const volumeState = getVolumeState(media);

  if (volumeState.lastFactor === 1 && volume !== 1) {
    volumeState.baselineVolume = media.volume;
  }

  if (volume === 1) {
    if (volumeState.gainNode) {
      volumeState.gainNode.gain.value = 1;
    }

    if (volumeState.lastFactor !== 1) {
      media.volume = volumeState.baselineVolume;
    } else {
      volumeState.baselineVolume = media.volume;
    }

    volumeState.lastFactor = volume;
    return;
  }

  if (volume <= 1) {
    const nativeVolume = Math.min(volumeState.baselineVolume * volume, 1);

    if (media.volume !== nativeVolume) {
      media.volume = nativeVolume;
    }

    if (volumeState.gainNode) {
      volumeState.gainNode.gain.value = 1;
    }

    volumeState.lastFactor = volume;
    return;
  }

  if (!isSafeToBoostVolume(media)) {
    // Boosting cross-origin media through Web Audio can mute playback on some
    // sites. Fall back to the native slider without exceeding the browser max.
    media.volume = Math.min(volumeState.baselineVolume * volume, 1);
    volumeState.lastFactor = volume;
    return;
  }

  if (media.volume !== volumeState.baselineVolume) {
    media.volume = volumeState.baselineVolume;
  }

  const boostedMedia = getBoostedMedia(media, volumeState);

  if (!boostedMedia?.gainNode || !boostedMedia.audioContext) {
    return;
  }

  boostedMedia.gainNode.gain.value = volume;
  boostedMedia.lastFactor = volume;

  if (boostedMedia.audioContext.state === 'suspended') {
    boostedMedia.audioContext.resume();
  }
};

const getVolumeState = (media: HTMLMediaElement): BoostedMedia => {
  const existingState = mediaVolumeStates.get(media);

  if (existingState) {
    return existingState;
  }

  const volumeState = {
    baselineVolume: media.volume,
    lastFactor: 1,
  };

  mediaVolumeStates.set(media, volumeState);

  return volumeState;
};

const getBoostedMedia = (
  media: HTMLMediaElement,
  volumeState: BoostedMedia
): BoostedMedia | null => {
  if (volumeState.gainNode && volumeState.audioContext) {
    return volumeState;
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

    source.connect(gainNode);
    gainNode.connect(audioContext.destination);
    volumeState.audioContext = audioContext;
    volumeState.gainNode = gainNode;

    media.addEventListener('play', () => {
      if (audioContext.state === 'suspended') {
        audioContext.resume();
      }
    });

    return volumeState;
  } catch (error) {
    console.error('Error trying to boost media volume: ', error);

    return null;
  }
};
