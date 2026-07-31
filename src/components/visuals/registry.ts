/**
 * Which tuner screens exist, and their order in the pager.
 *
 * Deliberately free of React and of the screens themselves: the settings store
 * needs the id type and the default, and importing the components to get them
 * would close a cycle (store -> visual -> hooks -> store).
 */

export type VisualId = 'field' | 'needle' | 'strobe';

export interface VisualMeta {
  id: VisualId;
  name: string;
  /** Small print in the screen's corner — what this instrument can show. */
  range: string;
  /** One line for the settings picker. */
  desc: string;
}

export const VISUALS: VisualMeta[] = [
  {
    id: 'field',
    name: 'Field',
    range: '±250 ¢',
    desc: 'A semitone either way, with the last few seconds trailing behind.',
  },
  {
    id: 'needle',
    name: 'Needle',
    range: '±50 ¢',
    desc: 'A moving-coil meter. Less range, far more resolution.',
  },
  {
    id: 'strobe',
    name: 'Strobe',
    range: 'DRIFT',
    desc: 'Bands that stop dead when you are there. The finest of the three.',
  },
];

export const DEFAULT_VISUAL: VisualId = 'field';

export function visualIndex(id: VisualId): number {
  const i = VISUALS.findIndex((v) => v.id === id);
  return i < 0 ? 0 : i;
}

/** Steps `by` places through the list, wrapping at both ends. */
export function stepVisual(id: VisualId, by: number): VisualId {
  const n = VISUALS.length;
  return VISUALS[(visualIndex(id) + by + n) % n].id;
}
