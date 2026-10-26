import { Chess } from 'chess.js';
import { positionKey, sideToMove, type Color } from '../chess/fen';
import { moveNumberFromFenBefore, type NotationStyle } from '../chess/notation';
import { mergedPath } from '../repertoire/merged';
import type { Line } from '../repertoire/lines';
import { lineName } from '../repertoire/lines';
import type { PositionInfo, PositionMove } from '../repertoire/positions';
import { autoGrade, cardId, isDue, isNew, priority, type AttemptResult, type Grade4, type ReviewCard } from '../srs/srs';
import { userColorForLine, userColorForRepertoire, type RepContext, type SessionContext } from './context';
import {
  alternativeFollowedFeedback,
  correctFeedback,
  errorFeedback,
  fbMove,
  learnShowFeedback,
  lineCompleteFeedback,
  outOfSelectionFeedback,
  revealedFeedback,
  strictAlternativeFeedback,
  timeoutFeedback,
  PAUL,
} from './feedback';
import { MODE_INFO, type Effect, type Feedback, type FeedbackStyle, type ItemState, type QueueItem, type SessionConfig, type SessionState } from './types';

export interface EngineDeps {
  ctx: SessionContext;
  cards: Map<string, ReviewCard>;
  style: FeedbackStyle;
  notation: NotationStyle;
  /** Au-delà, une bonne réponse est notée « Difficile ». */
  slowMs: number;
  fastMs: number;
}

export interface EngineResult {
  state: SessionState;
  effects: Effect[];
}

const emptyStats = () => ({
  questions: 0,
  correct: 0,
  errors: 0,
  hints: 0,
  revealed: 0,
  alternatives: 0,
  timeouts: 0,
  learned: 0,
  score: 0,
  streak: 0,
  bestStreak: 0,
  answerTimeMs: 0,
  itemsDone: 0,
});

function seededShuffle<T>(arr: T[], seed: string): T[] {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  const rand = () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return ((h ^= h >>> 16) >>> 0) / 4294967296;
  };
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export function sessionKind(config: SessionConfig): 'lines' | 'positions' | 'free' {
  const k = MODE_INFO[config.mode].kind;
  return k === 'explore' ? 'lines' : k;
}

/* ------------------------------------------------------------------ */
/* Construction de la file de questions                                */
/* ------------------------------------------------------------------ */

function lineIsMainOnly(rc: RepContext, line: Line, color: Color | 'both'): boolean {
  return line.steps.every((s) => {
    if (color !== 'both' && s.turn !== color) return true;
    const info = rc.index.get(s.posKeyBefore);
    const main = info?.moves.find((m) => m.selected);
    return !main || main.uci === s.uci;
  });
}

function lineQuestionCount(rc: RepContext, line: Line, config: SessionConfig): number {
  const color = userColorForLine(rc, line, config.color);
  return line.steps.filter((s) => (color === 'both' || s.turn === color) && (s.selected || config.askTrunk)).length;
}

interface Candidate {
  repertoireId: string;
  posKey: string;
  contextKey: string;
  ply: number;
  order: number;
}

/** Positions où l'utilisateur doit jouer un coup sélectionné. */
export function candidatePositions(rc: RepContext, config: SessionConfig): Candidate[] {
  const out = new Map<string, Candidate>();
  let order = 0;
  for (const line of rc.lines) {
    const color = userColorForLine(rc, line, config.color);
    line.steps.forEach((s, i) => {
      if (!s.selected) return;
      if (color !== 'both' && s.turn !== color) return;
      const existing = out.get(s.posKeyBefore);
      const contextKey = i === 0 ? `${line.key.slice(0, line.key.indexOf('|'))}|` : line.steps[i - 1].nodeKey;
      if (!existing || i < existing.ply) out.set(s.posKeyBefore, { repertoireId: rc.repertoire.id, posKey: s.posKeyBefore, contextKey, ply: i, order: existing?.order ?? order++ });
    });
  }
  return [...out.values()];
}

/** Nombre de lignes de la sélection qui dépendent du coup joué depuis cette position. */
export function criticality(rc: RepContext, info: PositionInfo | undefined): number {
  if (!info) return 0;
  let s = 0;
  for (const m of info.moves) {
    if (!m.selected) continue;
    let best = 0;
    for (const k of m.nodeKeys) best = Math.max(best, rc.leaves.get(k) ?? 0);
    s += best;
    if (m.nags.some((n) => n === 1 || n === 3 || n === 7)) s += 2;
  }
  return s;
}

function isFragile(card: ReviewCard | undefined, slowMs: number): boolean {
  if (!card) return false;
  if (card.reviewLater) return true;
  if (card.errors > 0 || card.hints > 0) return true;
  if (card.lastResult && card.lastResult !== 'correct' && card.lastResult !== 'learned') return true;
  return card.timedAttempts > 0 && card.totalTimeMs / card.timedAttempts > slowMs;
}

export function buildQueue(config: SessionConfig, deps: EngineDeps, now: number, seed: string): QueueItem[] {
  const kind = sessionKind(config);
  const reps = [...deps.ctx.reps.values()];
  if (kind === 'free') return [];
  if (kind === 'lines') {
    let items: Array<{ rc: RepContext; line: Line; prio: number; order: number }> = [];
    let order = 0;
    for (const rc of reps) {
      for (const line of rc.lines) {
        if (config.lineKeys?.length && !config.lineKeys.includes(line.key)) continue;
        const color = userColorForLine(rc, line, config.color);
        if (config.alternatives === 'main' && !lineIsMainOnly(rc, line, color)) continue;
        if (!lineQuestionCount(rc, line, config)) continue;
        let prio = 0;
        for (const s of line.steps) {
          if (color !== 'both' && s.turn !== color) continue;
          prio = Math.max(prio, priority(deps.cards.get(cardId(rc.repertoire.id, s.posKeyBefore)), now));
        }
        items.push({ rc, line, prio, order: order++ });
      }
    }
    if (config.order === 'random') items = seededShuffle(items, seed);
    else if (config.order === 'priority') items.sort((a, b) => b.prio - a.prio || a.order - b.order);
    else if (config.order === 'depth') items.sort((a, b) => a.line.steps.length - b.line.steps.length || a.order - b.order);
    return items.map((x) => ({ kind: 'line', repertoireId: x.rc.repertoire.id, lineKey: x.line.key }));
  }

  // Sessions par positions
  type Scored = Candidate & { score: number; card?: ReviewCard };
  let list: Scored[] = [];
  for (const rc of reps) {
    for (const c of candidatePositions(rc, config)) {
      const card = deps.cards.get(cardId(rc.repertoire.id, c.posKey));
      list.push({ ...c, card, score: priority(card, now) });
    }
  }
  const limit = config.maxQuestions > 0 ? config.maxQuestions : Infinity;
  if (config.mode === 'smart') {
    const due = list.filter((c) => c.card && isDue(c.card, now)).sort((a, b) => b.score - a.score);
    const later = list.filter((c) => c.card && !isDue(c.card, now) && c.card.reviewLater).sort((a, b) => b.score - a.score);
    const fresh = list.filter((c) => isNew(c.card)).sort((a, b) => a.ply - b.ply || a.order - b.order).slice(0, Math.max(0, config.newLimit));
    list = [...due, ...later, ...fresh];
  } else if (config.mode === 'critical') {
    list = list
      .map((c) => ({ ...c, score: criticality(deps.ctx.reps.get(c.repertoireId)!, deps.ctx.reps.get(c.repertoireId)!.index.get(c.posKey)) }))
      .sort((a, b) => b.score - a.score || a.ply - b.ply);
  } else if (config.mode === 'mistakes') {
    list = list
      .filter((c) => isFragile(c.card, deps.slowMs))
      .map((c) => ({ ...c, score: c.card ? (c.card.errors + c.card.hints * 0.5 + (c.card.reviewLater ? 2 : 0)) / Math.max(1, c.card.attempts) + (c.card.reviewLater ? 1 : 0) : 0 }))
      .sort((a, b) => b.score - a.score);
  } else {
    if (config.order === 'random') list = seededShuffle(list, seed);
    else if (config.order === 'sequential' || config.order === 'depth') list.sort((a, b) => a.ply - b.ply || a.order - b.order);
    else list.sort((a, b) => b.score - a.score || a.ply - b.ply);
  }
  return list.slice(0, limit).map((c) => ({ kind: 'position', repertoireId: c.repertoireId, posKey: c.posKey, contextKey: c.contextKey }));
}

/* ------------------------------------------------------------------ */
/* Cycle de vie de la session                                          */
/* ------------------------------------------------------------------ */

export function createSession(config: SessionConfig, deps: EngineDeps, now: number, id: string): EngineResult {
  const queue = buildQueue(config, deps, now, id);
  const state: SessionState = {
    id,
    config,
    createdAt: now,
    updatedAt: now,
    queue,
    cursor: 0,
    completedLines: [],
    phase: 'finished',
    deferred: [],
    answered: {},
    stats: emptyStats(),
    mistakes: [],
    level: 0,
    totalPausedMs: 0,
  };
  if (sessionKind(config) === 'free') return { state: startFree(state, deps, now), effects: [] };
  if (!queue.length) return { state: { ...state, phase: 'finished', finishedAt: now }, effects: [] };
  return startItem(state, deps, now);
}

function newItem(repertoireId: string, rootFen: string, now: number): ItemState {
  return {
    repertoireId,
    rootFen,
    stepIndex: 0,
    contextSteps: [],
    moves: [],
    attempts: 0,
    errors: 0,
    hints: 0,
    revealed: false,
    questionStartedAt: now,
    graded: false,
    logged: false,
    failed: false,
    questionsInItem: 0,
    shown: false,
  };
}

function startFree(state: SessionState, deps: EngineDeps, now: number): SessionState {
  const rc = [...deps.ctx.reps.values()][0];
  const root = rc?.forest.roots[0];
  if (!rc || !root) return { ...state, phase: 'finished', finishedAt: now };
  const item = newItem(rc.repertoire.id, root.fen, now);
  const s = { ...state, item, phase: 'question' as const, feedback: undefined };
  return freeAutoIfNeeded(s, deps, now);
}

function elapsedMinutes(state: SessionState, now: number) {
  return (now - state.createdAt - state.totalPausedMs) / 60000;
}

function limitsReached(state: SessionState, now: number): boolean {
  const c = state.config;
  if (c.maxQuestions > 0 && state.stats.questions >= c.maxQuestions) return true;
  if (c.maxMinutes > 0 && elapsedMinutes(state, now) >= c.maxMinutes) return true;
  return false;
}

function finish(state: SessionState, now: number): SessionState {
  return { ...state, phase: 'finished', finishedAt: now, item: state.item, updatedAt: now };
}

export function startItem(state: SessionState, deps: EngineDeps, now: number): EngineResult {
  let cursor = state.cursor;
  while (cursor < state.queue.length) {
    const q = state.queue[cursor];
    if (q.kind === 'line' && state.completedLines.includes(q.lineKey)) {
      cursor++;
      continue;
    }
    break;
  }
  if (cursor >= state.queue.length || limitsReached(state, now)) return { state: finish({ ...state, cursor }, now), effects: [] };
  const q = state.queue[cursor];
  const rc = deps.ctx.reps.get(q.repertoireId);
  if (!rc) return startItem({ ...state, cursor: cursor + 1 }, deps, now);
  if (q.kind === 'line') {
    const line = rc.linesByKey.get(q.lineKey);
    if (!line) return startItem({ ...state, cursor: cursor + 1 }, deps, now);
    const item = { ...newItem(rc.repertoire.id, line.rootFen, now), lineKey: line.key };
    return advanceLine({ ...state, cursor, item, feedback: undefined, phase: 'auto', updatedAt: now }, deps, now);
  }
  const node = rc.forest.byKey.get(q.contextKey);
  const info = rc.index.get(q.posKey);
  if (!node || !info) return startItem({ ...state, cursor: cursor + 1 }, deps, now);
  const path = mergedPath(rc.forest, node.key);
  let steps = path.slice(1).map((n, i) => ({ uci: n.uci, san: n.san, fenBefore: path[i].fen, fenAfter: n.fen }));
  let rootFen = path[0].fen;
  if (!state.config.showContext && steps.length > 1) {
    rootFen = steps[steps.length - 1].fenBefore;
    steps = steps.slice(-1);
  }
  const item: ItemState = { ...newItem(rc.repertoire.id, rootFen, now), posKey: q.posKey, contextSteps: steps };
  const phase = steps.length ? 'auto' : 'question';
  return { state: { ...state, cursor, item, phase, feedback: undefined, updatedAt: now }, effects: [] };
}

export function nextItem(state: SessionState, deps: EngineDeps, now: number): EngineResult {
  if (sessionKind(state.config) === 'free') return { state: startFree(state, deps, now), effects: [] };
  return startItem({ ...state, cursor: state.cursor + 1, item: undefined }, deps, now);
}

/* ------------------------------------------------------------------ */
/* Lecture de l'état courant                                           */
/* ------------------------------------------------------------------ */

export function currentFen(state: SessionState): string {
  const item = state.item;
  if (!item) return '';
  return item.moves.length ? item.moves[item.moves.length - 1].fenAfter : item.rootFen;
}

export function currentRep(state: SessionState, deps: EngineDeps): RepContext | undefined {
  return state.item ? deps.ctx.reps.get(state.item.repertoireId) : undefined;
}

export function currentLine(state: SessionState, deps: EngineDeps): Line | undefined {
  const rc = currentRep(state, deps);
  return state.item?.lineKey ? rc?.linesByKey.get(state.item.lineKey) : undefined;
}

/** Couleur jouée par l'utilisateur pour l'élément en cours. */
export function currentUserColor(state: SessionState, deps: EngineDeps): Color | 'both' {
  const rc = currentRep(state, deps);
  if (!rc) return 'w';
  const line = currentLine(state, deps);
  if (line) return userColorForLine(rc, line, state.config.color);
  if (state.item?.posKey) return sideToMove(rc.index.get(state.item.posKey)?.fen ?? currentFen(state));
  return userColorForRepertoire(rc, state.config.color);
}

export function orientation(state: SessionState, deps: EngineDeps): Color {
  const c = currentUserColor(state, deps);
  if (c === 'both') {
    const rc = currentRep(state, deps);
    return rc ? userColorForRepertoire(rc, 'auto') === 'b' ? 'b' : 'w' : 'w';
  }
  return c;
}

/** Règles effectives (le parcours progressif durcit la session avec le niveau). */
export function effectiveRules(state: SessionState): { hints: boolean; showLegal: boolean; secondsPerMove: number } {
  const c = state.config;
  if (c.mode === 'progressive') {
    const lv = state.level;
    return {
      hints: c.hints && lv < 2,
      showLegal: lv === 0 && c.showLegalMoves,
      secondsPerMove: lv >= 3 ? 10 : lv >= 2 ? 20 : 0,
    };
  }
  if (c.mode === 'blind') return { hints: false, showLegal: false, secondsPerMove: c.secondsPerMove };
  if (c.mode === 'timed') return { hints: c.hints, showLegal: c.showLegalMoves, secondsPerMove: c.secondsPerMove || 10 };
  return { hints: c.hints, showLegal: c.showLegalMoves, secondsPerMove: c.secondsPerMove };
}

export interface QuestionInfo {
  rc: RepContext;
  fen: string;
  posKey: string;
  info?: PositionInfo;
  /** Coups acceptés comme bonne réponse. */
  accepted: PositionMove[];
  /** Coup de référence (ligne suivie ou coup principal). */
  reference?: { uci: string; san: string };
  line?: Line;
  stepIndex: number;
  cardId: string;
}

export function questionInfo(state: SessionState, deps: EngineDeps): QuestionInfo | undefined {
  const item = state.item;
  const rc = currentRep(state, deps);
  if (!item || !rc) return undefined;
  const fen = currentFen(state);
  const posKey = positionKey(fen);
  const info = rc.index.get(posKey);
  const line = currentLine(state, deps);
  const policy = state.config.alternatives;
  let selectedMoves = (info?.moves ?? []).filter((m) => m.selected);
  let reference: { uci: string; san: string } | undefined;
  if (line) {
    const step = line.steps[item.stepIndex];
    if (step) {
      reference = { uci: step.uci, san: step.san };
      if (!step.selected) {
        // Question du tronc d'approche : le coup de la ligne est la réponse.
        const m = info?.moves.find((x) => x.uci === step.uci);
        selectedMoves = m ? [m] : [];
      }
    }
  } else if (selectedMoves.length) reference = { uci: selectedMoves[0].uci, san: selectedMoves[0].san };
  let accepted = selectedMoves;
  if (line && policy === 'strict' && reference) accepted = selectedMoves.filter((m) => m.uci === reference!.uci);
  if (policy === 'main' && selectedMoves.length) accepted = [selectedMoves[0]];
  return { rc, fen, posKey, info, accepted, reference, line, stepIndex: item.stepIndex, cardId: cardId(rc.repertoire.id, posKey) };
}

/* ------------------------------------------------------------------ */
/* Déroulement des lignes                                              */
/* ------------------------------------------------------------------ */

function shouldAsk(state: SessionState, rc: RepContext, line: Line, idx: number): boolean {
  const step = line.steps[idx];
  const color = userColorForLine(rc, line, state.config.color);
  if (color !== 'both' && step.turn !== color) return false;
  if (!step.selected && !state.config.askTrunk) return false;
  if (!state.config.repeatAnswered && state.answered[cardId(rc.repertoire.id, step.posKeyBefore)] === 'correct') return false;
  return true;
}

function beginQuestion(state: SessionState, deps: EngineDeps, now: number): SessionState {
  const item = state.item!;
  const base: SessionState = {
    ...state,
    phase: 'question',
    feedback: undefined,
    item: { ...item, attempts: 0, errors: 0, hints: 0, hintSquare: undefined, revealed: false, graded: false, logged: false, shown: false, questionStartedAt: now },
    updatedAt: now,
  };
  if (state.config.mode === 'learn') {
    const q = questionInfo(base, deps);
    if (q?.reference) {
      const exp = [fbMove(q.fen, q.reference.san, q.reference.uci, deps.notation)];
      const explanation = q.accepted.find((m) => m.uci === q.reference!.uci)?.comments[0];
      return { ...base, item: { ...base.item!, shown: true }, feedback: learnShowFeedback(exp, explanation, q.cardId) };
    }
  }
  return base;
}

/** Fait avancer une ligne jusqu'à la prochaine question, un coup automatique ou la fin. */
function advanceLine(state: SessionState, deps: EngineDeps, now: number): EngineResult {
  const rc = currentRep(state, deps);
  const line = currentLine(state, deps);
  const item = state.item!;
  if (!rc || !line) return { state: { ...state, phase: 'itemDone' }, effects: [] };
  if (item.stepIndex >= line.steps.length) return completeLine(state, deps, now);
  if (shouldAsk(state, rc, line, item.stepIndex)) {
    if (limitsReached(state, now)) return { state: finish(state, now), effects: [] };
    return { state: beginQuestion(state, deps, now), effects: [] };
  }
  return { state: { ...state, phase: 'auto', updatedAt: now }, effects: [] };
}

function completeLine(state: SessionState, deps: EngineDeps, now: number): EngineResult {
  const rc = currentRep(state, deps)!;
  const line = currentLine(state, deps)!;
  const item = state.item!;
  const questions = item.moves.filter((m) => m.by === 'user' && m.result).length;
  const correct = item.moves.filter((m) => m.result === 'correct').length;
  const name = lineName(line, rc.gameLabel, deps.notation);
  return {
    state: {
      ...state,
      completedLines: state.completedLines.includes(line.key) ? state.completedLines : [...state.completedLines, line.key],
      phase: 'itemDone',
      feedback: state.config.mode === 'learn' ? { ...lineCompleteFeedback(correct, questions, name), message: 'Ligne présentée. Elle reviendra bientôt en révision intelligente.' } : lineCompleteFeedback(correct, questions, name),
      stats: { ...state.stats, itemsDone: state.stats.itemsDone + 1 },
      updatedAt: now,
    },
    effects: [{ type: 'touchRepertoire', repertoireId: rc.repertoire.id }],
  };
}

/** Joue le coup automatique suivant (adversaire, tronc ou contexte). */
export function stepAuto(state: SessionState, deps: EngineDeps, now: number): EngineResult {
  if (state.phase !== 'auto' || !state.item) return { state, effects: [] };
  const item = state.item;
  if (item.posKey !== undefined && !item.lineKey) {
    const [next, ...rest] = item.contextSteps;
    if (!next) return { state: beginQuestion(state, deps, now), effects: [] };
    const moved: SessionState = {
      ...state,
      item: { ...item, contextSteps: rest, moves: [...item.moves, { ...next, by: 'auto' }] },
    };
    return rest.length ? { state: moved, effects: [] } : { state: beginQuestion(moved, deps, now), effects: [] };
  }
  if (sessionKind(state.config) === 'free') return { state: freeAutoReply(state, deps, now), effects: [] };
  const line = currentLine(state, deps);
  if (!line) return { state, effects: [] };
  const step = line.steps[item.stepIndex];
  if (!step) return completeLine(state, deps, now);
  const moved: SessionState = {
    ...state,
    item: { ...item, stepIndex: item.stepIndex + 1, moves: [...item.moves, { uci: step.uci, san: step.san, fenBefore: step.fenBefore, fenAfter: step.fenAfter, by: 'auto' }] },
  };
  return advanceLine(moved, deps, now);
}

/** Joue tous les coups automatiques d'un coup (utile pour les tests et l'option « sans animation »). */
export function runAuto(state: SessionState, deps: EngineDeps, now: number): EngineResult {
  let s = state;
  const effects: Effect[] = [];
  let guard = 0;
  while (s.phase === 'auto' && guard++ < 1000) {
    const r = stepAuto(s, deps, now);
    s = r.state;
    effects.push(...r.effects);
  }
  return { state: s, effects };
}

/* ------------------------------------------------------------------ */
/* Réponses                                                            */
/* ------------------------------------------------------------------ */

export type MoveInput = { from: string; to: string; promotion?: string } | { uci: string } | { san: string };

export function resolveMove(fen: string, input: MoveInput): { uci: string; san: string; fenAfter: string } | null {
  const chess = new Chess(fen);
  try {
    let mv;
    if ('uci' in input) mv = chess.move({ from: input.uci.slice(0, 2), to: input.uci.slice(2, 4), promotion: input.uci[4] }, { strict: false });
    else if ('san' in input) mv = chess.move(input.san, { strict: false });
    else mv = chess.move({ from: input.from, to: input.to, promotion: input.promotion }, { strict: false });
    return { uci: mv.from + mv.to + (mv.promotion ?? ''), san: mv.san, fenAfter: mv.after };
  } catch {
    return null;
  }
}

function makeLog(state: SessionState, q: QuestionInfo, result: AttemptResult, timeMs: number, hints: number, played: { uci: string; san: string } | undefined, firstTry: boolean, grade: Grade4 | undefined, now: number): Effect {
  const { moveNumber, color } = moveNumberFromFenBefore(q.fen);
  return {
    type: 'log',
    log: {
      ts: now,
      sessionId: state.id,
      mode: state.config.mode,
      repertoireId: q.rc.repertoire.id,
      posKey: q.posKey,
      cardId: q.cardId,
      fen: q.fen,
      lineKey: q.line?.key,
      gameId: q.line?.gameIds[0] ?? q.info?.nodeKeys.map((k) => q.rc.forest.byKey.get(k)?.occurrences[0]?.gameId).find(Boolean),
      color,
      moveNumber,
      result,
      firstTry,
      playedUci: played?.uci,
      playedSan: played?.san,
      expectedSans: q.accepted.map((m) => m.san),
      expectedUcis: q.accepted.map((m) => m.uci),
      timeMs,
      hints,
      grade,
      graded: state.config.graded,
    },
  };
}

function gradeEffect(state: SessionState, deps: EngineDeps, q: QuestionInfo, result: AttemptResult, timeMs: number, hints: number, hadError: boolean): { effects: Effect[]; grade?: Grade4 } {
  if (!state.config.graded) return { effects: [] };
  const card = deps.cards.get(q.cardId);
  if (result === 'learned' && card && !isNew(card)) return { effects: [] };
  const grade = autoGrade(card, { result, timeMs, hints, hadError, errorCountsAsFailure: state.config.onError.countAsFailure, slowMs: deps.slowMs, fastMs: deps.fastMs });
  return {
    grade,
    effects: [
      {
        type: 'grade',
        cardId: q.cardId,
        repertoireId: q.rc.repertoire.id,
        posKey: q.posKey,
        fen: q.fen,
        turn: sideToMove(q.fen),
        grade,
        result,
        timeMs,
        hints,
        countsInStats: result !== 'learned',
      },
    ],
  };
}

function severityFor(q: QuestionInfo, deps: EngineDeps): Feedback['severity'] {
  const card = deps.cards.get(q.cardId);
  const total = q.rc.lines.length || 1;
  const dependent = criticality(q.rc, q.info);
  const ref = q.reference ? q.info?.moves.find((m) => m.uci === q.reference!.uci) : undefined;
  const refSan = ref ? fbMove(q.fen, ref.san, ref.uci, deps.notation).label : '';
  const knew = card && (card.streak >= 2 || card.fsrs.stability >= 7);
  if (dependent >= Math.max(10, total * 0.25)) {
    return { level: 'critical', text: `Critique : ${dependent} ligne${dependent > 1 ? 's' : ''} de ta sélection passent par ${refSan || 'ce coup'}.` };
  }
  if (knew) return { level: 'major', text: 'Importante : tu connaissais ce coup (oubli d’une position maîtrisée).' };
  if (dependent >= 3) return { level: 'major', text: `Importante : ${dependent} lignes dépendent de ce coup.` };
  return { level: 'minor', text: dependent > 1 ? `Mineure : ${dependent} lignes concernées.` : 'Mineure : une seule ligne concernée.' };
}

function continuation(q: QuestionInfo, refUci: string): { fen: string; sans: string[] } | undefined {
  const m = q.info?.moves.find((x) => x.uci === refUci);
  if (!m) return undefined;
  if (q.line) {
    const step = q.line.steps[q.stepIndex];
    if (step?.uci === refUci) return { fen: step.fenAfter, sans: q.line.steps.slice(q.stepIndex + 1, q.stepIndex + 5).map((s) => s.san) };
  }
  // Suite principale depuis le nœud du coup attendu.
  const node = q.rc.forest.byKey.get(m.nodeKeys[0]);
  const sans: string[] = [];
  let cur = node;
  while (cur && cur.children.length && sans.length < 4) {
    const next = cur.children.find((c) => q.rc.resolved.selected.has(c.key)) ?? cur.children[0];
    sans.push(next.san);
    cur = next;
  }
  return { fen: m.toFen, sans };
}

function variationNameFor(q: QuestionInfo, deps: EngineDeps): string | undefined {
  if (q.line) return lineName(q.line, q.rc.gameLabel, deps.notation);
  const m = q.accepted[0];
  if (!m) return undefined;
  const node = q.rc.forest.byKey.get(m.nodeKeys[0]);
  const gid = node?.occurrences[0]?.gameId;
  return gid ? q.rc.gameLabel(gid) : undefined;
}

function whereInRepertoire(q: QuestionInfo, uci: string): string | undefined {
  const m = q.info?.moves.find((x) => x.uci === uci);
  const node = m ? q.rc.forest.byKey.get(m.nodeKeys[0]) : undefined;
  const gid = node?.occurrences[0]?.gameId;
  return gid ? q.rc.gameLabel(gid) : undefined;
}

function recordUserMove(state: SessionState, mv: { uci: string; san: string; fenAfter: string }, fenBefore: string, result: NonNullable<SessionState['item']>['moves'][number]['result']): ItemState {
  const item = state.item!;
  return { ...item, moves: [...item.moves, { uci: mv.uci, san: mv.san, fenBefore, fenAfter: mv.fenAfter, by: 'user', result }] };
}

function bumpLevel(state: SessionState, ok: boolean): number {
  if (state.config.mode !== 'progressive') return state.level;
  if (!ok) return Math.max(0, state.level - 1);
  return (state.stats.streak + 1) % 5 === 0 ? Math.min(3, state.level + 1) : state.level;
}

/** Réponse correcte (ou coup attendu rejoué) : enregistre, puis avance. */
function onCorrect(state: SessionState, deps: EngineDeps, q: QuestionInfo, mv: { uci: string; san: string; fenAfter: string }, now: number, followed?: { lineKey: string; step: number }): EngineResult {
  const item = state.item!;
  const timeMs = Math.max(0, now - item.questionStartedAt);
  const effects: Effect[] = [];
  let result: AttemptResult = 'correct';
  if (item.shown) result = 'learned';
  else if (item.revealed) result = 'revealed';
  const firstTry = item.errors === 0 && !item.revealed && item.hints === 0 && !item.shown;
  const stats = { ...state.stats };
  const answered = { ...state.answered };
  if (!item.logged) {
    const g = item.graded ? { effects: [] as Effect[], grade: undefined } : gradeEffect(state, deps, q, result, timeMs, item.hints, item.errors > 0);
    effects.push(...g.effects);
    effects.push(makeLog(state, q, result, timeMs, item.hints, mv, firstTry, g.grade, now));
    stats.questions++;
    if (result === 'learned') stats.learned++;
    else if (result === 'revealed') stats.revealed++;
    else {
      stats.correct++;
      stats.answerTimeMs += timeMs;
    }
    answered[q.cardId] = result === 'revealed' ? 'error' : 'correct';
  } else if (!item.graded) {
    // Erreur corrigée qui ne compte pas comme un échec : note « Difficile » (ou « À revoir » si la solution a été vue).
    effects.push(...gradeEffect(state, deps, q, item.revealed ? 'revealed' : 'correct', timeMs, item.hints, true).effects);
  }
  if (firstTry) {
    stats.streak++;
    stats.bestStreak = Math.max(stats.bestStreak, stats.streak);
    const spm = effectiveRules(state).secondsPerMove;
    if (state.config.scoring) stats.score += 10 + (spm ? Math.max(0, Math.round((spm * 1000 - timeMs) / 1000)) : 0);
  }
  let newItem = recordUserMove(state, mv, q.fen, result === 'learned' ? 'learned' : firstTry ? 'correct' : item.revealed ? 'revealed' : 'error');
  newItem = { ...newItem, questionsInItem: newItem.questionsInItem + 1, graded: true, logged: true };
  const fbMv = fbMove(q.fen, mv.san, mv.uci, deps.notation);
  const explanation = q.info?.moves.find((m) => m.uci === mv.uci)?.comments[0];
  let feedback: Feedback | undefined = firstTry ? correctFeedback(deps.style, fbMv, q.cardId + stats.questions, explanation, q.cardId) : undefined;
  if (followed && q.reference) {
    feedback = alternativeFollowedFeedback(fbMv, fbMove(q.fen, q.reference.san, q.reference.uci, deps.notation), undefined, q.cardId);
    stats.alternatives++;
  }
  let s: SessionState = { ...state, stats, answered, item: newItem, feedback, level: bumpLevel(state, firstTry), updatedAt: now };

  if (state.config.askConfidence && firstTry && state.config.graded) {
    s = { ...s, phase: 'feedback', item: { ...s.item!, ...(followed ? { lineKey: followed.lineKey, stepIndex: followed.step + 1 } : q.line ? { stepIndex: item.stepIndex + 1 } : {}) } };
    return { state: s, effects };
  }
  return { state: continueAfterAnswer(s, deps, now, q, followed).state, effects };
}

function continueAfterAnswer(s: SessionState, deps: EngineDeps, now: number, q: QuestionInfo, followed?: { lineKey: string; step: number }): EngineResult {
  const kind = sessionKind(s.config);
  if (kind === 'free') return { state: { ...s, phase: 'auto' }, effects: [] };
  if (q.line) {
    const item = s.item!;
    const moved = followed ? { ...item, lineKey: followed.lineKey, stepIndex: followed.step + 1 } : { ...item, stepIndex: item.stepIndex + 1 };
    return advanceLine({ ...s, item: moved }, deps, now);
  }
  return { state: { ...s, phase: 'itemDone', stats: { ...s.stats, itemsDone: s.stats.itemsDone + 1 } }, effects: [{ type: 'touchRepertoire', repertoireId: q.rc.repertoire.id }] };
}

/** Après une note de confiance (ou « continuer » après une bonne réponse en attente). */
export function confirmAnswer(state: SessionState, deps: EngineDeps, now: number, grade?: Grade4): EngineResult {
  if (state.phase !== 'feedback' || state.feedback?.kind === 'error' || state.feedback?.kind === 'timeout') return { state, effects: [] };
  const effects: Effect[] = [];
  if (grade && state.feedback?.cardId && state.config.graded) effects.push({ type: 'regrade', cardId: state.feedback.cardId, grade });
  const item = state.item!;
  const kind = sessionKind(state.config);
  if (kind === 'free') return { state: { ...state, phase: 'auto' }, effects };
  if (item.lineKey) {
    const r = advanceLine({ ...state, feedback: state.feedback }, deps, now);
    return { state: r.state, effects: [...effects, ...r.effects] };
  }
  return { state: { ...state, phase: 'itemDone', stats: { ...state.stats, itemsDone: state.stats.itemsDone + 1 } }, effects };
}

function onError(state: SessionState, deps: EngineDeps, q: QuestionInfo, mv: { uci: string; san: string; fenAfter: string }, now: number): EngineResult {
  const item = state.item!;
  const cfg = state.config;
  const timeMs = Math.max(0, now - item.questionStartedAt);
  const effects: Effect[] = [];
  const learning = item.shown;
  const first = !item.logged && !learning;
  const stats = { ...state.stats };
  const answered = { ...state.answered };
  let graded = item.graded;
  let logged = item.logged;
  if (first) {
    stats.questions++;
    stats.errors++;
    stats.streak = 0;
    if (cfg.scoring) stats.score = stats.score - 5;
    answered[q.cardId] = 'error';
    let grade: Grade4 | undefined;
    if (!item.graded && (cfg.onError.countAsFailure || !cfg.onError.retry)) {
      const g = gradeEffect(state, deps, q, 'error', timeMs, item.hints, true);
      effects.push(...g.effects);
      grade = g.grade;
      graded = true;
    }
    effects.push(makeLog(state, q, 'error', timeMs, item.hints, mv, true, grade, now));
    logged = true;
  }
  const errors = item.errors + 1;
  const reveal = !cfg.onError.retry || errors > cfg.onError.revealAfter || learning;
  const expected = q.accepted.length ? q.accepted : q.info?.moves.filter((m) => m.selected) ?? [];
  const ref = q.reference && expected.some((m) => m.uci === q.reference!.uci) ? q.reference : expected[0];
  const ordered = ref ? [...expected].sort((a, b) => (a.uci === ref.uci ? -1 : b.uci === ref.uci ? 1 : 0)) : expected;
  const fbExpected = ordered.map((m) => fbMove(q.fen, m.san, m.uci, deps.notation));
  const explanation = ref ? q.info?.moves.find((m) => m.uci === ref.uci)?.comments[0] : undefined;
  let feedback = errorFeedback({
    style: deps.style,
    notation: deps.notation,
    fenBefore: q.fen,
    played: mv,
    expected: fbExpected,
    continuation: ref ? continuation(q, ref.uci) : undefined,
    variationName: variationNameFor(q, deps),
    explanation,
    severity: severityFor(q, deps),
    graded: cfg.graded && !learning,
    seed: q.cardId + errors,
    cardId: q.cardId,
  });
  if (!reveal) {
    const left = cfg.onError.revealAfter - errors + 1;
    feedback = {
      ...feedback,
      expected: undefined,
      referenceLine: undefined,
      explanation: undefined,
      message: `Tu as joué ${feedback.played!.label} : ce n’est pas le coup prévu par ton répertoire. Encore ${left} essai${left > 1 ? 's' : ''} avant la solution.`,
    };
  }
  const mistakes = first && !learning
    ? [...state.mistakes, { cardId: q.cardId, repertoireId: q.rc.repertoire.id, fen: q.fen, played: mv.san, expected: fbExpected.map((e) => e.label), label: variationNameFor(q, deps) ?? '' }]
    : state.mistakes;
  const newItem: ItemState = { ...item, errors, attempts: item.attempts + 1, graded, logged, revealed: item.revealed || reveal, failed: true };
  const s: SessionState = { ...state, stats, answered, mistakes, item: newItem, level: bumpLevel(state, false), updatedAt: now };
  if (cfg.feedback === 'deferred' && !learning) {
    // Pas de correction immédiate : on enregistre et on poursuit avec le coup attendu.
    const deferred = [...state.deferred, feedback];
    return { state: playExpectedAndContinue({ ...s, deferred }, deps, now, q).state, effects };
  }
  return { state: { ...s, phase: 'feedback', feedback }, effects };
}

function playExpectedAndContinue(state: SessionState, deps: EngineDeps, now: number, q: QuestionInfo): EngineResult {
  const ref = q.reference && q.accepted.some((m) => m.uci === q.reference!.uci) ? q.reference : q.accepted[0] ?? q.reference;
  if (!ref) return { state: { ...state, phase: 'itemDone' }, effects: [] };
  const mv = resolveMove(q.fen, { uci: ref.uci });
  if (!mv) return { state: { ...state, phase: 'itemDone' }, effects: [] };
  const item = recordUserMove(state, mv, q.fen, 'error');
  const s = { ...state, item: { ...item, graded: true, logged: true }, feedback: undefined };
  if (state.config.onError.stopLine && q.line) return completeLine(s, deps, now);
  return continueAfterAnswer(s, deps, now, q);
}

/** Coup joué par l'utilisateur. */
export function submitMove(state: SessionState, deps: EngineDeps, input: MoveInput, now: number): EngineResult & { illegal?: boolean } {
  if (state.phase !== 'question' || !state.item) return { state, effects: [] };
  const q = questionInfo(state, deps);
  if (!q) return { state, effects: [] };
  const mv = resolveMove(q.fen, input);
  if (!mv) return { state: { ...state, feedback: { kind: 'info', title: 'Coup illégal', message: 'Ce coup n’est pas légal dans cette position. Aucune pénalité.' } }, effects: [], illegal: true };

  if (sessionKind(state.config) === 'free') return submitFree(state, deps, q, mv, now);

  if (q.accepted.some((m) => m.uci === mv.uci)) {
    if (q.line && q.reference && mv.uci !== q.reference.uci) {
      // Autre coup sélectionné : on suit une ligne compatible.
      const entries = q.rc.linesByPos.get(q.posKey) ?? [];
      const compatible = entries.filter((e) => e.line.steps[e.step].uci === mv.uci);
      const pending = compatible.find((e) => !state.completedLines.includes(e.line.key) && state.queue.some((x, i) => i >= state.cursor && x.kind === 'line' && x.lineKey === e.line.key));
      const target = pending ?? compatible.find((e) => !state.completedLines.includes(e.line.key)) ?? compatible[0];
      if (target) return onCorrect(state, deps, q, mv, now, { lineKey: target.line.key, step: target.step });
    }
    return onCorrect(state, deps, q, mv, now);
  }
  const selectedHere = q.info?.moves.filter((m) => m.selected) ?? [];
  if (selectedHere.some((m) => m.uci === mv.uci)) {
    const fb = strictAlternativeFeedback(fbMove(q.fen, mv.san, mv.uci, deps.notation), state.config.alternatives === 'main' ? 'main' : 'strict');
    return { state: { ...state, feedback: fb, stats: { ...state.stats } }, effects: [] };
  }
  if (q.info?.moves.some((m) => m.uci === mv.uci)) {
    return { state: { ...state, feedback: outOfSelectionFeedback(fbMove(q.fen, mv.san, mv.uci, deps.notation), whereInRepertoire(q, mv.uci)) }, effects: [] };
  }
  if (!q.accepted.length) {
    // Aucun coup de référence : pas d'erreur de répertoire possible.
    return { state: { ...state, feedback: { kind: 'info', title: 'Pas de coup prévu', message: 'Ton répertoire ne prévoit aucun coup ici.' } }, effects: [] };
  }
  return onError(state, deps, q, mv, now);
}

/** Rejouer la position après une erreur (le coup attendu reste à trouver ou à rejouer). */
export function retry(state: SessionState, now: number): SessionState {
  if (state.phase !== 'feedback' || !state.item) return state;
  const keepFeedback = state.item.revealed ? state.feedback : undefined;
  return { ...state, phase: 'question', feedback: keepFeedback ? { ...keepFeedback, kind: 'revealed', title: 'Rejoue le bon coup' } : undefined, item: { ...state.item, questionStartedAt: now }, updatedAt: now };
}

/** Poursuivre : le coup attendu est joué automatiquement. */
export function continueAfterError(state: SessionState, deps: EngineDeps, now: number): EngineResult {
  if (state.phase !== 'feedback' || !state.item) return { state, effects: [] };
  if (state.feedback?.kind !== 'error' && state.feedback?.kind !== 'timeout') return confirmAnswer(state, deps, now);
  const q = questionInfo(state, deps);
  if (!q) return { state, effects: [] };
  const effects: Effect[] = [];
  let s = state;
  if (!state.item.graded) {
    // Erreur avec seconde tentative non utilisée : la question est notée comme échec.
    const g = gradeEffect(state, deps, q, 'error', now - state.item.questionStartedAt, state.item.hints, true);
    effects.push(...g.effects);
    s = { ...s, item: { ...s.item!, graded: true } };
  }
  if (sessionKind(state.config) === 'free') {
    const ref = q.accepted[0];
    if (!ref) return { state: { ...s, phase: 'itemDone' }, effects };
    const mv = resolveMove(q.fen, { uci: ref.uci })!;
    const item = recordUserMove(s, mv, q.fen, 'error');
    return { state: { ...s, item, feedback: undefined, phase: 'auto' }, effects };
  }
  const r = playExpectedAndContinue(s, deps, now, q);
  return { state: r.state, effects: [...effects, ...r.effects] };
}

/** Révèle la solution (compte comme un indice complet). */
export function revealSolution(state: SessionState, deps: EngineDeps, now: number): EngineResult {
  if ((state.phase !== 'question' && state.phase !== 'feedback') || !state.item) return { state, effects: [] };
  const q = questionInfo(state, deps);
  if (!q || !q.accepted.length) return { state, effects: [] };
  const ref = q.reference && q.accepted.some((m) => m.uci === q.reference!.uci) ? q.reference : q.accepted[0];
  const exp = [...q.accepted].sort((a) => (a.uci === ref.uci ? -1 : 1)).map((m) => fbMove(q.fen, m.san, m.uci, deps.notation));
  const explanation = q.info?.moves.find((m) => m.uci === ref.uci)?.comments[0];
  const item = state.item;
  const effects: Effect[] = [];
  let stats = { ...state.stats, hints: state.stats.hints + 1 };
  const answered = { ...state.answered };
  const timeMs = now - item.questionStartedAt;
  let grade: Grade4 | undefined;
  if (!item.graded) {
    const g = gradeEffect(state, deps, q, 'revealed', timeMs, item.hints + 1, item.errors > 0);
    effects.push(...g.effects);
    grade = g.grade;
  }
  if (!item.logged) {
    effects.push(makeLog(state, q, 'revealed', timeMs, item.hints + 1, undefined, false, grade, now));
    stats = { ...stats, questions: stats.questions + 1, revealed: stats.revealed + 1, streak: 0, score: state.config.scoring ? stats.score - 3 : stats.score };
    answered[q.cardId] = 'error';
  }
  return {
    state: { ...state, stats, answered, phase: 'question', feedback: revealedFeedback(exp, explanation, q.cardId), item: { ...item, revealed: true, graded: true, logged: true, hints: item.hints + 1, failed: true }, updatedAt: now },
    effects,
  };
}

/** Indice : met en évidence la pièce à jouer. */
export function requestHint(state: SessionState, deps: EngineDeps, now: number): SessionState {
  if (state.phase !== 'question' || !state.item || !effectiveRules(state).hints) return state;
  const q = questionInfo(state, deps);
  const ref = q?.reference && q.accepted.some((m) => m.uci === q.reference!.uci) ? q.reference : q?.accepted[0];
  if (!ref) return state;
  return {
    ...state,
    stats: { ...state.stats, hints: state.stats.hints + 1, score: state.config.scoring ? state.stats.score - 3 : state.stats.score },
    item: { ...state.item, hints: state.item.hints + 1, hintSquare: ref.uci.slice(0, 2) },
    feedback: { kind: 'info', title: 'Indice', message: 'La pièce à jouer est mise en évidence sur l’échiquier.' },
    updatedAt: now,
  };
}

/** Temps écoulé (test chronométré). */
export function timeout(state: SessionState, deps: EngineDeps, now: number): EngineResult {
  if (state.phase !== 'question' || !state.item) return { state, effects: [] };
  const q = questionInfo(state, deps);
  if (!q || !q.accepted.length) return { state, effects: [] };
  const item = state.item;
  const effects: Effect[] = [];
  let stats = state.stats;
  const answered = { ...state.answered };
  let grade: Grade4 | undefined;
  if (!item.graded) {
    const g = gradeEffect(state, deps, q, 'timeout', now - item.questionStartedAt, item.hints, false);
    effects.push(...g.effects);
    grade = g.grade;
  }
  if (!item.logged) {
    effects.push(makeLog(state, q, 'timeout', now - item.questionStartedAt, item.hints, undefined, true, grade, now));
    stats = { ...stats, questions: stats.questions + 1, timeouts: stats.timeouts + 1, streak: 0 };
    answered[q.cardId] = 'error';
  }
  const exp = q.accepted.map((m) => fbMove(q.fen, m.san, m.uci, deps.notation));
  return {
    state: { ...state, stats, answered, phase: 'feedback', feedback: timeoutFeedback(exp, state.config.graded, q.cardId), item: { ...item, graded: true, logged: true, revealed: true, failed: true }, level: bumpLevel(state, false), updatedAt: now },
    effects,
  };
}

/** Recommencer la ligne (ou la position) en cours. */
export function restartItem(state: SessionState, deps: EngineDeps, now: number): EngineResult {
  if (!state.item) return { state, effects: [] };
  if (sessionKind(state.config) === 'free') return { state: startFree(state, deps, now), effects: [] };
  return startItem({ ...state, item: undefined }, deps, now);
}

/** Passer l'élément en cours (non compté comme réussite). */
export function skipItem(state: SessionState, deps: EngineDeps, now: number): EngineResult {
  return nextItem(state, deps, now);
}

export function endSession(state: SessionState, now: number): SessionState {
  return finish(state, now);
}

/* ------------------------------------------------------------------ */
/* Entraînement libre                                                  */
/* ------------------------------------------------------------------ */

function freeUserTurn(state: SessionState, deps: EngineDeps): boolean {
  const c = currentUserColor(state, deps);
  return c === 'both' || sideToMove(currentFen(state)) === c;
}

function freeAutoIfNeeded(state: SessionState, deps: EngineDeps, now: number): SessionState {
  if (freeUserTurn(state, deps)) return { ...state, phase: 'question', item: { ...state.item!, questionStartedAt: now } };
  return { ...state, phase: 'auto' };
}

function freeAutoReply(state: SessionState, deps: EngineDeps, now: number): SessionState {
  const rc = currentRep(state, deps)!;
  const fen = currentFen(state);
  const info = rc.index.get(positionKey(fen));
  const options = (info?.moves ?? []).filter((m) => m.selected);
  if (!options.length) {
    return { ...state, phase: 'itemDone', feedback: { kind: 'lineComplete', title: 'Fin de la ligne', message: 'Ton répertoire sélectionné ne prévoit pas de suite ici.' } };
  }
  // Choix pondéré vers les lignes les moins maîtrisées.
  const weights = options.map((m) => {
    const next = rc.index.get(m.toPosKey);
    const card = deps.cards.get(cardId(rc.repertoire.id, m.toPosKey));
    return 1 + priority(card, now) + (next?.moves.length ?? 0) * 0.1;
  });
  const total = weights.reduce((a, b) => a + b, 0);
  let r = ((now % 9973) / 9973) * total;
  let pick = options[0];
  for (let i = 0; i < options.length; i++) {
    r -= weights[i];
    if (r <= 0) {
      pick = options[i];
      break;
    }
  }
  const mv = resolveMove(fen, { uci: pick.uci })!;
  const item = state.item!;
  const s: SessionState = { ...state, item: { ...item, moves: [...item.moves, { uci: mv.uci, san: mv.san, fenBefore: fen, fenAfter: mv.fenAfter, by: 'auto' }] } };
  return freeAutoIfNeeded(s, deps, now);
}

function submitFree(state: SessionState, deps: EngineDeps, q: QuestionInfo, mv: { uci: string; san: string; fenAfter: string }, now: number): EngineResult {
  const userColor = currentUserColor(state, deps);
  const mover = sideToMove(q.fen);
  const isUserSide = userColor === 'both' ? mover === userColorForRepertoire(q.rc, 'auto') : mover === userColor;
  const selected = q.info?.moves.filter((m) => m.selected) ?? [];
  const inSel = selected.some((m) => m.uci === mv.uci);
  const inRep = q.info?.moves.some((m) => m.uci === mv.uci);
  const label = fbMove(q.fen, mv.san, mv.uci, deps.notation);
  if (inSel) return onCorrect(state, deps, q, mv, now);
  if (!isUserSide) {
    // Coup adverse : on l'accepte et on indique s'il sort du répertoire.
    const item = recordUserMove(state, mv, q.fen, undefined);
    const fb: Feedback = inRep
      ? outOfSelectionFeedback(label, whereInRepertoire(q, mv.uci))
      : { kind: 'opponentOutOfBook', title: 'L’adversaire sort de ton répertoire', message: `Aucune suite n’est prévue après ${label.label}. À toi de jouer avec tes principes — ce n’est pas une erreur de ta part.` };
    const s: SessionState = { ...state, item, feedback: fb };
    return { state: freeAutoIfNeeded(s, deps, now), effects: [] };
  }
  if (inRep) return { state: { ...state, feedback: outOfSelectionFeedback(label, whereInRepertoire(q, mv.uci)) }, effects: [] };
  if (!selected.length) {
    const item = recordUserMove(state, mv, q.fen, undefined);
    return { state: freeAutoIfNeeded({ ...state, item, feedback: { kind: 'info', title: 'Hors répertoire', message: 'Ton répertoire ne prévoit rien ici : aucune référence à vérifier.' } }, deps, now), effects: [] };
  }
  return onError(state, deps, q, mv, now);
}

/** Annule le dernier coup (entraînement libre). */
export function takeBack(state: SessionState, deps: EngineDeps, now: number): SessionState {
  if (!state.item || sessionKind(state.config) !== 'free') return state;
  let moves = state.item.moves.slice(0, -1);
  const userColor = currentUserColor(state, deps);
  while (moves.length && userColor !== 'both' && sideToMove(moves[moves.length - 1].fenAfter) !== userColor) moves = moves.slice(0, -1);
  return { ...state, phase: 'question', feedback: undefined, item: { ...state.item, moves, errors: 0, graded: false, logged: false, revealed: false, hints: 0, hintSquare: undefined, questionStartedAt: now } };
}

export { PAUL };
