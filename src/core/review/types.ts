import type { Color } from '../chess/fen';
import type { RepertoireSelection } from '../repertoire/selection';
import type { AttemptResult, Grade4 } from '../srs/srs';

export type ReviewMode = 'smart' | 'learn' | 'full' | 'mistakes';

export const MODE_INFO: Record<ReviewMode, { label: string; description: string; kind: 'lines' | 'positions' }> = {
  smart: {
    label: 'Révision du jour',
    description: 'Les positions à revoir aujourd’hui (répétition espacée), puis quelques nouvelles.',
    kind: 'positions',
  },
  learn: {
    label: 'Apprendre',
    description: 'Chaque coup est d’abord montré, puis tu le rejoues. Les lignes jamais vues passent en premier.',
    kind: 'lines',
  },
  full: {
    label: 'Toute la sélection',
    description: 'Chaque ligne sélectionnée, du premier au dernier coup.',
    kind: 'lines',
  },
  mistakes: {
    label: 'Mes erreurs',
    description: 'Les positions ratées, révélées ou hésitantes.',
    kind: 'positions',
  },
};

export function isReviewMode(mode: unknown): mode is ReviewMode {
  return typeof mode === 'string' && Object.prototype.hasOwnProperty.call(MODE_INFO, mode);
}

/** Libellé d'un mode, y compris ceux des anciennes versions (journal, sessions enregistrées). */
export function modeLabel(mode: string): string {
  return isReviewMode(mode) ? MODE_INFO[mode].label : 'Ancien mode';
}

export type FeedbackStyle = 'sober' | 'encouraging' | 'humorous' | 'competitive';

export interface SessionConfig {
  mode: ReviewMode;
  selections: RepertoireSelection[];
  /** Nombre maximal de positions (ou de lignes pour les modes par lignes), 0 = tout. */
  maxQuestions: number;
  /** Après une erreur, un second essai avant de montrer la solution. */
  secondChance: boolean;
  /** Nouvelles positions maximum (révision du jour). */
  newLimit: number;
  /** Demander la note (À revoir… Facile) après chaque bonne réponse. */
  askConfidence: boolean;
  /** Lignes imposées (révision d'une variante précise). */
  lineKeys?: string[];
}

export type QueueItem =
  | { kind: 'line'; repertoireId: string; lineKey: string }
  | { kind: 'position'; repertoireId: string; posKey: string; contextKey: string };

export interface PlayedMove {
  uci: string;
  san: string;
  fenBefore: string;
  fenAfter: string;
  by: 'user' | 'auto';
  /** Résultat si c'était une question. */
  result?: 'correct' | 'error' | 'revealed' | 'learned';
}

export type FeedbackKind = 'correct' | 'outOfSelection' | 'error' | 'revealed' | 'learnShow' | 'lineComplete' | 'info';

export interface FeedbackMove {
  san: string;
  uci: string;
  label: string;
}

export interface Feedback {
  kind: FeedbackKind;
  title: string;
  message: string;
  played?: FeedbackMove;
  expected?: FeedbackMove[];
  explanation?: string;
  severity?: { level: 'minor' | 'major' | 'critical'; text: string };
  quip?: string;
  cardId?: string;
}

export type Phase = 'auto' | 'question' | 'feedback' | 'itemDone' | 'finished';

export interface ItemState {
  repertoireId: string;
  rootFen: string;
  /** Ligne actuellement suivie (sessions par lignes). */
  lineKey?: string;
  /** Index de la prochaine étape dans la ligne suivie. */
  stepIndex: number;
  /** Position interrogée (sessions par positions). */
  posKey?: string;
  /** Coups d'approche restant à jouer avant la question (sessions par positions). */
  contextSteps: Array<{ uci: string; san: string; fenBefore: string; fenAfter: string }>;
  moves: PlayedMove[];
  /** État de la question en cours. */
  attempts: number;
  errors: number;
  hints: number;
  hintSquare?: string;
  revealed: boolean;
  questionStartedAt: number;
  /** La note FSRS de la question a déjà été appliquée. */
  graded: boolean;
  /** La question a déjà été comptée (une seule entrée de journal par question). */
  logged: boolean;
  failed: boolean;
  questionsInItem: number;
  /** Mode apprentissage : le coup a été montré, il faut le rejouer. */
  shown: boolean;
}

export interface SessionStats {
  questions: number;
  correct: number;
  errors: number;
  hints: number;
  revealed: number;
  alternatives: number;
  learned: number;
  answerTimeMs: number;
  itemsDone: number;
}

export interface SessionMistake {
  cardId: string;
  repertoireId: string;
  fen: string;
  played?: string;
  expected: string[];
  label: string;
}

export interface SessionState {
  id: string;
  config: SessionConfig;
  createdAt: number;
  updatedAt: number;
  finishedAt?: number;
  queue: QueueItem[];
  cursor: number;
  completedLines: string[];
  item?: ItemState;
  phase: Phase;
  feedback?: Feedback;
  answered: Record<string, 'correct' | 'error'>;
  stats: SessionStats;
  mistakes: SessionMistake[];
}

export interface AttemptLog {
  ts: number;
  sessionId: string;
  /** Mode de la session (les anciennes versions en avaient d'autres). */
  mode: ReviewMode | (string & {});
  repertoireId: string;
  posKey: string;
  cardId: string;
  fen: string;
  lineKey?: string;
  gameId?: string;
  color: Color;
  moveNumber: number;
  result: AttemptResult;
  firstTry: boolean;
  playedUci?: string;
  playedSan?: string;
  expectedSans: string[];
  expectedUcis: string[];
  timeMs: number;
  hints: number;
  grade?: Grade4;
  graded: boolean;
}

export type Effect =
  | { type: 'log'; log: AttemptLog }
  | { type: 'grade'; cardId: string; repertoireId: string; posKey: string; fen: string; turn: Color; grade: Grade4; result: AttemptResult; timeMs: number; hints: number; countsInStats: boolean }
  | { type: 'regrade'; cardId: string; grade: Grade4 }
  | { type: 'touchRepertoire'; repertoireId: string };
