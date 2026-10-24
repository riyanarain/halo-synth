export const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

export const SCALES = {
  Minor: [0, 2, 3, 5, 7, 8, 10],
  Major: [0, 2, 4, 5, 7, 9, 11],
  Dorian: [0, 2, 3, 5, 7, 9, 10],
  Phrygian: [0, 1, 3, 5, 7, 8, 10],
  Lydian: [0, 2, 4, 6, 7, 9, 11],
  Mixolydian: [0, 2, 4, 5, 7, 9, 10],
};

export const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

// Semitones above the tonic for any (possibly negative / > 7) scale-degree index.
export function scaleSemi(scale, idx) {
  const n = scale.length;
  return scale[((idx % n) + n) % n] + 12 * Math.floor(idx / n);
}

// Four chord tones as semitones above the tonic. The 4th voice is the 7th, or the octave.
export function chordFor(scale, degree, { seventh = false, sus2 = false } = {}) {
  const steps = [0, sus2 ? 1 : 2, 4, seventh ? 6 : 7];
  return steps.map((k) => scaleSemi(scale, degree + k));
}

export function chordName(scale, key, degree, { seventh = false, sus2 = false } = {}) {
  const root = scaleSemi(scale, degree);
  const third = scaleSemi(scale, degree + 2) - root;
  const fifth = scaleSemi(scale, degree + 4) - root;
  let q = third === 3 ? 'm' : '';
  if (fifth === 6) q = third === 3 ? 'dim' : 'b5';
  if (fifth === 8) q = 'aug';
  if (sus2) q = 'sus2';
  return NOTE_NAMES[(key + root) % 12] + q + (seventh ? '7' : '');
}
