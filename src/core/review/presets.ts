import type { RepertoireSelection } from '../repertoire/selection';
import type { ReviewMode, SessionConfig } from './types';

export function defaultConfig(mode: ReviewMode, selections: RepertoireSelection[]): SessionConfig {
  const base: SessionConfig = {
    mode,
    selections,
    color: 'auto',
    maxQuestions: 0,
    maxMinutes: 0,
    order: 'priority',
    hints: true,
    showLegalMoves: false,
    alternatives: 'follow',
    feedback: 'immediate',
    onError: { retry: true, revealAfter: 0, stopLine: false, countAsFailure: true },
    askTrunk: false,
    repeatAnswered: false,
    showContext: true,
    secondsPerMove: 0,
    graded: true,
    newLimit: 10,
    askConfidence: false,
    analysis: false,
    scoring: false,
    includeAbandoned: false,
  };
  switch (mode) {
    case 'smart':
      return { ...base, maxQuestions: 30 };
    case 'learn':
      return { ...base, order: 'sequential', repeatAnswered: true, showLegalMoves: true };
    case 'blind':
      return { ...base, hints: false, showContext: false, order: 'priority' };
    case 'full':
      return { ...base, order: 'sequential' };
    case 'critical':
      return { ...base, maxQuestions: 20 };
    case 'mistakes':
      return { ...base, maxQuestions: 30 };
    case 'line':
      return { ...base, order: 'sequential', alternatives: 'strict', repeatAnswered: true };
    case 'free':
      return { ...base, graded: false, order: 'random' };
    case 'timed':
      return { ...base, secondsPerMove: 10, scoring: true, hints: false, maxQuestions: 20 };
    case 'progressive':
      return { ...base, order: 'depth', scoring: true, showLegalMoves: true };
  }
}

export interface Preset {
  id: string;
  name: string;
  description: string;
  icon: string;
  build: (selections: RepertoireSelection[]) => SessionConfig;
}

export const PRESETS: Preset[] = [
  {
    id: 'daily',
    name: 'Révision quotidienne',
    description: 'Positions dues aujourd’hui, puis jusqu’à 10 nouvelles. Environ 30 questions.',
    icon: 'calendar',
    build: (s) => ({ ...defaultConfig('smart', s), presetName: 'Révision quotidienne' }),
  },
  {
    id: 'quick',
    name: 'Rapide 5 minutes',
    description: 'Les positions les plus prioritaires pendant 5 minutes.',
    icon: 'zap',
    build: (s) => ({ ...defaultConfig('smart', s), maxMinutes: 5, maxQuestions: 0, newLimit: 3, presetName: 'Rapide 5 minutes' }),
  },
  {
    id: 'full',
    name: 'Révision complète',
    description: 'Toutes les lignes sélectionnées, dans l’ordre du répertoire.',
    icon: 'list-tree',
    build: (s) => ({ ...defaultConfig('full', s), presetName: 'Révision complète' }),
  },
  {
    id: 'mistakes',
    name: 'Révision des erreurs',
    description: 'Seulement les coups ratés, hésitants ou révélés.',
    icon: 'target',
    build: (s) => ({ ...defaultConfig('mistakes', s), presetName: 'Révision des erreurs' }),
  },
  {
    id: 'black',
    name: 'Révision des Noirs',
    description: 'Tu joues les Noirs dans les lignes sélectionnées.',
    icon: 'circle-dot',
    build: (s) => ({ ...defaultConfig('full', s), color: 'b', presetName: 'Révision des Noirs' }),
  },
  {
    id: 'white',
    name: 'Révision des Blancs',
    description: 'Tu joues les Blancs dans les lignes sélectionnées.',
    icon: 'circle',
    build: (s) => ({ ...defaultConfig('full', s), color: 'w', presetName: 'Révision des Blancs' }),
  },
  {
    id: 'nohint',
    name: 'Test sans indice',
    description: 'Aucun indice, une erreur compte comme un échec.',
    icon: 'eye-off',
    build: (s) => ({ ...defaultConfig('blind', s), presetName: 'Test sans indice' }),
  },
  {
    id: 'timed',
    name: 'Entraînement chronométré',
    description: '20 positions, 10 secondes par coup, score.',
    icon: 'timer',
    build: (s) => ({ ...defaultConfig('timed', s), presetName: 'Entraînement chronométré' }),
  },
];
