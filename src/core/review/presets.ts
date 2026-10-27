import type { RepertoireSelection } from '../repertoire/selection';
import { MODE_INFO, type ReviewMode, type SessionConfig } from './types';

/** Longueurs proposées : positions pour les modes par positions, lignes sinon (0 = tout). */
export const LENGTHS: Record<'positions' | 'lines', number[]> = {
  positions: [10, 20, 50, 0],
  lines: [5, 10, 20, 0],
};

const DEFAULT_LENGTH: Record<ReviewMode, number> = { smart: 0, learn: 5, full: 0, mistakes: 20 };

export function defaultLength(mode: ReviewMode): number {
  return DEFAULT_LENGTH[mode];
}

export function lengthUnit(mode: ReviewMode, n: number): string {
  const lines = MODE_INFO[mode].kind === 'lines';
  return lines ? `ligne${n > 1 ? 's' : ''}` : `position${n > 1 ? 's' : ''}`;
}

export function defaultConfig(
  mode: ReviewMode,
  selections: RepertoireSelection[],
  prefs: { newLimit?: number; askConfidence?: boolean; secondChance?: boolean } = {},
): SessionConfig {
  return {
    mode,
    selections,
    maxQuestions: DEFAULT_LENGTH[mode],
    secondChance: prefs.secondChance ?? false,
    newLimit: prefs.newLimit ?? 10,
    askConfidence: prefs.askConfidence ?? false,
  };
}
