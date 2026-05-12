type AudioMeter = {
  audioContext: AudioContext;
  analyser: AnalyserNode;
  frequencyData: Float32Array;
  key: string;
  stream: MediaStream;
};

const BAR_COUNT = 20;
const MIN_FREQUENCY = 35;
const MAX_FREQUENCY = 16000;
const FLOOR_DB = -86;
const CEILING_DB = -18;
const audioMeters = new WeakMap<HTMLMediaElement, AudioMeter>();

const getCurrentMedia = (): HTMLMediaElement | null => {
  const medias = Array.from(
    document.querySelectorAll<HTMLMediaElement>('video, audio')
  );

  return (
    medias.find(
      (media) =>
        !media.paused &&
        !media.ended &&
        !media.muted &&
        media.volume > 0 &&
        media.readyState > 1
    ) ||
    medias.find((media) => !media.paused && !media.ended) ||
    medias[0] ||
    null
  );
};

const getMediaKey = (media: HTMLMediaElement, stream?: MediaStream) => {
  const trackKey =
    stream
      ?.getAudioTracks()
      .map((track) => `${track.id}:${track.readyState}`)
      .join('|') || '';

  return [
    window.location.href,
    document.title,
    media.currentSrc || media.src || window.location.href,
    media.duration || 0,
    trackKey,
  ].join('::');
};

const destroyMeter = (meter: AudioMeter) => {
  try {
    meter.stream.getTracks().forEach((track) => track.stop());
    meter.audioContext.close();
  } catch (error) {
    return;
  }
};

const getMeter = (media: HTMLMediaElement): AudioMeter | null => {
  const existingMeter = audioMeters.get(media);

  if (existingMeter) {
    const hasLiveTrack = existingMeter.stream
      .getAudioTracks()
      .some((track) => track.readyState === 'live');

    if (hasLiveTrack && existingMeter.key === getMediaKey(media, existingMeter.stream)) {
      return existingMeter;
    }

    destroyMeter(existingMeter);
    audioMeters.delete(media);
  }

  const AudioContextConstructor =
    window.AudioContext || (window as any).webkitAudioContext;
  const captureStream =
    (media as any).captureStream || (media as any).mozCaptureStream;

  if (!AudioContextConstructor || !captureStream) {
    return null;
  }

  try {
    const stream = captureStream.call(media) as MediaStream;
    const audioTracks = stream.getAudioTracks();

    if (!audioTracks.length) {
      return null;
    }

    const audioContext = new AudioContextConstructor();
    const source = audioContext.createMediaStreamSource(stream);
    const analyser = audioContext.createAnalyser();
    const silentGain = audioContext.createGain();

    analyser.fftSize = 2048;
    analyser.minDecibels = FLOOR_DB;
    analyser.maxDecibels = CEILING_DB;
    analyser.smoothingTimeConstant = 0.55;
    const frequencyData = new Float32Array(analyser.frequencyBinCount);
    silentGain.gain.value = 0;

    source.connect(analyser);
    analyser.connect(silentGain);
    silentGain.connect(audioContext.destination);

    const meter = {
      audioContext,
      analyser,
      frequencyData,
      key: getMediaKey(media, stream),
      stream,
    };
    audioMeters.set(media, meter);

    return meter;
  } catch (error) {
    return null;
  }
};

const createEmptyLevels = () => Array.from({ length: BAR_COUNT }, () => 0);

const frequencyToBin = (frequency: number, meter: AudioMeter) => {
  const nyquist = meter.audioContext.sampleRate / 2;
  const clampedFrequency = Math.min(Math.max(frequency, 0), nyquist);

  return Math.min(
    meter.frequencyData.length - 1,
    Math.max(
      0,
      Math.round((clampedFrequency / nyquist) * (meter.frequencyData.length - 1))
    )
  );
};

const decibelsToPower = (decibels: number) => Math.pow(10, decibels / 10);

const powerToDecibels = (power: number) => 10 * Math.log10(power);

const decibelsToLevel = (decibels: number, bandIndex: number) => {
  if (!Number.isFinite(decibels) || decibels <= FLOOR_DB + 3) {
    return 0;
  }

  const position = bandIndex / (BAR_COUNT - 1);
  const gain =
    position < 0.25
      ? 0.95
      : position < 0.65
      ? 1.08
      : 1.24;
  const normalized = Math.min(
    Math.max((decibels - FLOOR_DB) / (CEILING_DB - FLOOR_DB), 0),
    1
  );

  return Math.min(Math.pow(normalized, 1.35) * gain, 1);
};

const readFrequencyLevels = (meter: AudioMeter) => {
  if (meter.audioContext.state === 'suspended') {
    meter.audioContext.resume();
  }

  meter.analyser.getFloatFrequencyData(meter.frequencyData);

  const levels = [];
  const maxFrequency = Math.min(
    MAX_FREQUENCY,
    meter.audioContext.sampleRate / 2
  );

  for (let i = 0; i < BAR_COUNT; i++) {
    const startFrequency =
      MIN_FREQUENCY *
      Math.pow(maxFrequency / MIN_FREQUENCY, i / BAR_COUNT);
    const endFrequency =
      MIN_FREQUENCY *
      Math.pow(maxFrequency / MIN_FREQUENCY, (i + 1) / BAR_COUNT);
    const start = frequencyToBin(startFrequency, meter);
    const end = Math.max(start + 1, frequencyToBin(endFrequency, meter));
    let powerTotal = 0;
    let count = 0;

    for (let bin = start; bin <= end; bin++) {
      const decibels = meter.frequencyData[bin];

      if (!Number.isFinite(decibels)) {
        continue;
      }

      powerTotal += decibelsToPower(decibels);
      count += 1;
    }

    const averagePower = powerTotal / Math.max(count, 1);
    const bandDecibels = powerToDecibels(Math.max(averagePower, 1e-12));

    levels.push(decibelsToLevel(bandDecibels, i));
  }

  return levels;
};

export const getAudioLevel = () => {
  const media = getCurrentMedia();

  if (!media) {
    return {
      ok: true,
      level: 0,
      levels: createEmptyLevels(),
      isPlaying: false,
      hasLiveMeter: false,
    };
  }

  const isPlaying = !media.paused && !media.ended;

  if (!isPlaying || media.muted || media.volume <= 0) {
    return {
      ok: true,
      level: 0,
      levels: createEmptyLevels(),
      isPlaying,
      hasLiveMeter: false,
    };
  }

  const meter = getMeter(media);

  if (!meter) {
    return {
      ok: true,
      level: 0,
      levels: createEmptyLevels(),
      isPlaying,
      hasLiveMeter: false,
    };
  }

  const levels = readFrequencyLevels(meter);
  const level =
    levels.reduce((total, value) => total + value, 0) / levels.length || 0;

  return {
    ok: true,
    level,
    levels,
    isPlaying,
    hasLiveMeter: true,
  };
};
