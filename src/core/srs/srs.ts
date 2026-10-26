import { createEmptyCard, fsrs, generatorParameters, Rating, State, type Card, type Grade } from 'ts-fsrs';
import type { Color } from '../chess/fen';

/**
 * Répétition espacée : chaque position où l'utilisateur doit jouer est une
 * « carte » planifiée par FSRS (Free Spaced Repetition Scheduler, algorithme
 * moderne utilisé notamment par Anki) via la bibliothèque ts-fsrs.
 */

export type Grade4 = 1 | 2 | 3 | 4;
export const GRADE_LABELS: Record<Grade4, string> = { 1: 'À revoir', 2: 'Difficile', 3: 'Bien', 4: 'Facile' };

export interface StoredFsrs {
  due: number;
  stability: number;
  difficulty: number;
  elapsed_days: number;
  scheduled_days: number;
  learning_steps: number;
  reps: number;
  lapses: number;
  state: State;
  last_review?: number;
}

export interface ReviewCard {
  /** `${repertoireId}|${posKey}` */
  id: string;
  repertoireId: string;
  posKey: string;
  fen: string;
  turn: Color;
  /** Signature des coups prévus : si elle change, l'historique de planification est réinitialisé. */
  answers: string;
  fsrs: StoredFsrs;
  attempts: number;
  successes: number;
  errors: number;
  hints: number;
  totalTimeMs: number;
  timedAttempts: number;
  lastReviewedAt?: number;
  lastResult?: AttemptResult;
  /** Dernier niveau de confiance déclaré (1 à 4). */
  confidence?: Grade4;
  streak: number;
  favorite: boolean;
  reviewLater: boolean;
  note?: string;
  /** La position n'existe plus dans le répertoire (après modification du PGN). */
  obsolete: boolean;
  resetAt?: number;
  createdAt: number;
}

export type AttemptResult = 'correct' | 'error' | 'revealed' | 'timeout' | 'learned';

export function cardId(repertoireId: string, posKey: string): string {
  return `${repertoireId}|${posKey}`;
}

let scheduler = fsrs(generatorParameters({ enable_fuzz: false, request_retention: 0.9, maximum_interval: 3650 }));

export function configureScheduler(opts: { retention?: number; maxIntervalDays?: number }) {
  scheduler = fsrs(
    generatorParameters({ enable_fuzz: false, request_retention: opts.retention ?? 0.9, maximum_interval: opts.maxIntervalDays ?? 3650 }),
  );
}

function toStored(c: Card): StoredFsrs {
  return {
    due: c.due.getTime(),
    stability: c.stability,
    difficulty: c.difficulty,
    elapsed_days: c.elapsed_days,
    scheduled_days: c.scheduled_days,
    learning_steps: c.learning_steps,
    reps: c.reps,
    lapses: c.lapses,
    state: c.state,
    last_review: c.last_review?.getTime(),
  };
}

function fromStored(s: StoredFsrs): Card {
  return {
    ...s,
    due: new Date(s.due),
    last_review: s.last_review != null ? new Date(s.last_review) : undefined,
  };
}

export function newCard(repertoireId: string, posKey: string, fen: string, turn: Color, answers: string, now: number): ReviewCard {
  return {
    id: cardId(repertoireId, posKey),
    repertoireId,
    posKey,
    fen,
    turn,
    answers,
    fsrs: toStored(createEmptyCard(new Date(now))),
    attempts: 0,
    successes: 0,
    errors: 0,
    hints: 0,
    totalTimeMs: 0,
    timedAttempts: 0,
    streak: 0,
    favorite: false,
    reviewLater: false,
    obsolete: false,
    createdAt: now,
  };
}

/** Réinitialise la planification (le répertoire a changé les coups attendus). */
export function resetScheduling(card: ReviewCard, answers: string, now: number): ReviewCard {
  return { ...card, answers, fsrs: toStored(createEmptyCard(new Date(now))), streak: 0, resetAt: now };
}

export interface GradeInput {
  result: AttemptResult;
  timeMs: number;
  hints: number;
  /** Erreur commise avant de trouver le bon coup. */
  hadError: boolean;
  /** Une erreur corrigée compte quand même comme un échec. */
  errorCountsAsFailure: boolean;
  slowMs: number;
  fastMs: number;
}

/** Note automatique proposée à partir du résultat (modifiable par l'utilisateur). */
export function autoGrade(card: Pick<ReviewCard, 'streak' | 'fsrs'> | undefined, g: GradeInput): Grade4 {
  if (g.result === 'error' || g.result === 'timeout' || g.result === 'revealed' || g.result === 'learned') return 1;
  if (g.hadError) return g.errorCountsAsFailure ? 1 : 2;
  if (g.hints > 0) return 2;
  if (g.timeMs > g.slowMs) return 2;
  if (card && g.timeMs < g.fastMs && card.streak >= 2 && card.fsrs.state === State.Review) return 4;
  return 3;
}

export interface ApplyInput {
  grade: Grade4;
  result: AttemptResult;
  timeMs: number;
  hints: number;
  now: number;
  /** Les présentations (mode apprentissage) ne comptent ni comme réussite ni comme échec. */
  countsInStats: boolean;
  confidence?: Grade4;
}

export function applyReview(card: ReviewCard, input: ApplyInput): ReviewCard {
  const next = scheduler.next(fromStored(card.fsrs), new Date(input.now), input.grade as Grade);
  const success = input.result === 'correct';
  return {
    ...card,
    fsrs: toStored(next.card),
    attempts: card.attempts + (input.countsInStats ? 1 : 0),
    successes: card.successes + (input.countsInStats && success ? 1 : 0),
    errors: card.errors + (input.countsInStats && (input.result === 'error' || input.result === 'timeout') ? 1 : 0),
    hints: card.hints + input.hints,
    totalTimeMs: card.totalTimeMs + (input.countsInStats ? input.timeMs : 0),
    timedAttempts: card.timedAttempts + (input.countsInStats ? 1 : 0),
    lastReviewedAt: input.now,
    lastResult: input.result,
    confidence: input.confidence ?? card.confidence,
    streak: success && input.grade >= 2 ? card.streak + 1 : 0,
    reviewLater: input.result === 'correct' ? false : card.reviewLater || input.result !== 'learned',
  };
}

export function retrievability(card: ReviewCard, now: number): number {
  if (card.fsrs.state === State.New) return 0;
  return scheduler.get_retrievability(fromStored(card.fsrs), new Date(now), false);
}

export function isDue(card: ReviewCard, now: number): boolean {
  return card.fsrs.state !== State.New && card.fsrs.due <= now;
}

export function isNew(card: ReviewCard | undefined): boolean {
  return !card || card.fsrs.state === State.New;
}

export type MasteryLevel = 'new' | 'learning' | 'fragile' | 'solid' | 'mastered';

export const MASTERY_LABELS: Record<MasteryLevel, string> = {
  new: 'Nouvelle',
  learning: 'En apprentissage',
  fragile: 'Fragile',
  solid: 'Solide',
  mastered: 'Maîtrisée',
};

/**
 * Niveau de maîtrise d'une position. « Maîtrisée » exige au moins trois
 * révisions réussies et une stabilité FSRS d'au moins 21 jours : une seule
 * réussite ne suffit jamais.
 */
export function masteryOf(card: ReviewCard | undefined, now: number): MasteryLevel {
  if (!card || card.fsrs.state === State.New) return 'new';
  if (card.fsrs.state === State.Learning || card.fsrs.state === State.Relearning) return 'learning';
  const r = retrievability(card, now);
  if (card.lastResult === 'error' || card.lastResult === 'timeout' || card.lastResult === 'revealed' || r < 0.8) return 'fragile';
  if (card.fsrs.stability >= 21 && card.successes >= 3) return 'mastered';
  if (card.fsrs.stability >= 3) return 'solid';
  return 'learning';
}

export const MASTERY_SCORE: Record<MasteryLevel, number> = { new: 0, learning: 0.25, fragile: 0.15, solid: 0.7, mastered: 1 };

/** Score de priorité (plus haut = à réviser en premier). */
export function priority(card: ReviewCard | undefined, now: number): number {
  if (!card || card.fsrs.state === State.New) return 1;
  let p = 0;
  const overdueDays = (now - card.fsrs.due) / 86400000;
  if (overdueDays >= 0) p += 10 + Math.min(10, overdueDays);
  p += (1 - retrievability(card, now)) * 10;
  if (card.reviewLater) p += 6;
  if (card.attempts > 0) p += (card.errors / card.attempts) * 8;
  p += Math.min(4, card.hints);
  return p;
}

export function nextIntervalPreview(card: ReviewCard, now: number): Record<Grade4, number> {
  const preview = scheduler.repeat(fromStored(card.fsrs), new Date(now));
  return {
    1: preview[Rating.Again].card.due.getTime() - now,
    2: preview[Rating.Hard].card.due.getTime() - now,
    3: preview[Rating.Good].card.due.getTime() - now,
    4: preview[Rating.Easy].card.due.getTime() - now,
  };
}

export function formatInterval(ms: number): string {
  const min = Math.round(ms / 60000);
  if (min < 60) return `${Math.max(1, min)} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h} h`;
  const d = Math.round(h / 24);
  if (d < 31) return `${d} j`;
  const mo = Math.round(d / 30);
  if (mo < 12) return `${mo} mois`;
  return `${(d / 365).toFixed(1)} an${d >= 730 ? 's' : ''}`;
}

export { State };
