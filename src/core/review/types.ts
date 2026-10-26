import type { Color } from '../chess/fen';
import type { RepertoireSelection } from '../repertoire/selection';
import type { AttemptResult, Grade4 } from '../srs/srs';

export type ReviewMode =
  | 'smart'
  | 'learn'
  | 'blind'
  | 'full'
  | 'critical'
  | 'mistakes'
  | 'line'
  | 'free'
  | 'timed'
  | 'progressive';

export const MODE_INFO: Record<ReviewMode | 'explore', { label: string; short: string; description: string; kind: 'lines' | 'positions' | 'free' | 'explore' }> = {
  smart: {
    label: 'Révision intelligente',
    short: 'Intelligente',
    description: 'Les positions dues selon la répétition espacée, puis les plus fragiles et quelques nouvelles.',
    kind: 'positions',
  },
  learn: {
    label: 'Apprentissage guidé',
    short: 'Guidé',
    description: 'Chaque coup attendu est d’abord montré, puis tu le rejoues. Idéal pour découvrir une ligne.',
    kind: 'lines',
  },
  blind: {
    label: 'Révision à l’aveugle',
    short: 'À l’aveugle',
    description: 'Une position, aucun indice : trouve le coup de ton répertoire.',
    kind: 'positions',
  },
  full: {
    label: 'Répertoire complet',
    short: 'Complet',
    description: 'Parcourt toutes les lignes sélectionnées et t’interroge à chaque coup.',
    kind: 'lines',
  },
  critical: {
    label: 'Coups critiques',
    short: 'Critiques',
    description: 'Les positions dont dépendent le plus de lignes : une erreur ici te fait sortir de ton répertoire.',
    kind: 'positions',
  },
  mistakes: {
    label: 'Révision des erreurs',
    short: 'Erreurs',
    description: 'Uniquement les coups ratés, hésitants ou révélés.',
    kind: 'positions',
  },
  line: {
    label: 'Contre une ligne',
    short: 'Contre une ligne',
    description: 'L’application joue les coups adverses d’une ligne précise ; tu joues les tiens, dans la couleur de ton choix.',
    kind: 'lines',
  },
  free: {
    label: 'Entraînement libre',
    short: 'Libre',
    description: 'Joue librement : chaque coup est comparé à tes lignes sélectionnées.',
    kind: 'free',
  },
  timed: {
    label: 'Test chronométré',
    short: 'Chronométré',
    description: 'Retrouve les coups dans un temps limité.',
    kind: 'positions',
  },
  progressive: {
    label: 'Parcours progressif',
    short: 'Progressif',
    description: 'Des lignes courtes aux plus longues ; indices puis chronomètre quand tu enchaînes les réussites.',
    kind: 'lines',
  },
  explore: {
    label: 'Exploration',
    short: 'Exploration',
    description: 'Navigue librement dans tes variantes, sans notation.',
    kind: 'explore',
  },
};

export type AlternativesPolicy = 'follow' | 'strict' | 'main';
export type QuestionOrder = 'priority' | 'sequential' | 'random' | 'depth';
export type FeedbackStyle = 'sober' | 'encouraging' | 'humorous' | 'competitive';

export interface ErrorPolicy {
  /** Autorise une nouvelle tentative après une erreur. */
  retry: boolean;
  /** Révèle automatiquement le coup attendu après N erreurs (0 = immédiatement). */
  revealAfter: number;
  /** L'erreur interrompt la ligne. */
  stopLine: boolean;
  /** Une erreur corrigée compte quand même comme un échec. */
  countAsFailure: boolean;
}

export interface SessionConfig {
  mode: ReviewMode;
  selections: RepertoireSelection[];
  /** Camp joué : 'auto' = celui du répertoire (ou de la partie). */
  color: Color | 'auto' | 'both';
  /** Nombre maximal de questions (0 = illimité). */
  maxQuestions: number;
  /** Durée maximale en minutes (0 = illimitée). */
  maxMinutes: number;
  order: QuestionOrder;
  hints: boolean;
  showLegalMoves: boolean;
  alternatives: AlternativesPolicy;
  /** Retour immédiat après chaque coup ou résumé à la fin. */
  feedback: 'immediate' | 'deferred';
  onError: ErrorPolicy;
  /** Demander aussi les coups du tronc d'approche (avant la sélection). */
  askTrunk: boolean;
  /** Dans une session par lignes, redemander les positions déjà réussies. */
  repeatAnswered: boolean;
  /** Rejouer la ligne jusqu'à la position (sinon la position est affichée directement). */
  showContext: boolean;
  /** Temps par coup en secondes (0 = sans limite). */
  secondsPerMove: number;
  /** Mettre à jour la répétition espacée. */
  graded: boolean;
  /** Nouvelles positions maximum (mode intelligent). */
  newLimit: number;
  /** Demander la confiance après chaque bonne réponse. */
  askConfidence: boolean;
  analysis: boolean;
  scoring: boolean;
  /** Ligne imposée (mode « contre une ligne »). */
  lineKeys?: string[];
  includeAbandoned: boolean;
  /** Libellé du préréglage utilisé. */
  presetName?: string;
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
  result?: 'correct' | 'error' | 'revealed' | 'alternative' | 'learned' | 'timeout';
}

export type FeedbackKind =
  | 'correct'
  | 'alternative'
  | 'outOfSelection'
  | 'notMain'
  | 'error'
  | 'timeout'
  | 'revealed'
  | 'learnShow'
  | 'learned'
  | 'lineComplete'
  | 'opponentOutOfBook'
  | 'info';

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
  referenceLine?: string;
  variationName?: string;
  explanation?: string;
  severity?: { level: 'minor' | 'major' | 'critical'; text: string };
  quip?: string;
  priorityNote?: string;
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
  timeouts: number;
  learned: number;
  score: number;
  streak: number;
  bestStreak: number;
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
  /** Feedbacks différés (affichés à la fin si feedback = 'deferred'). */
  deferred: Feedback[];
  answered: Record<string, 'correct' | 'error'>;
  stats: SessionStats;
  mistakes: SessionMistake[];
  /** Niveau courant du parcours progressif. */
  level: number;
  totalPausedMs: number;
}

export interface AttemptLog {
  ts: number;
  sessionId: string;
  mode: ReviewMode;
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
