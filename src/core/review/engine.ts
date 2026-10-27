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

/** Seuils de temps de la note automatique. */
export const ANSWER_TIMING = { slowMs: 12000, fastMs: 2500 };

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
  learned: 0,
  answerTimeMs: 0,
  itemsDone: 0,
});

export function sessionKind(config: SessionConfig): 'lines' | 'positions' {
  return MODE_INFO[config.mode].kind;
}

/* ------------------------------------------------------------------ */
/* Construction de la file de questions                                */
/* ------------------------------------------------------------------ */

function lineQuestionCount(rc: RepContext, line: Line): number {
  const color = userColorForLine(rc, line);
  return line.steps.filter((s) => s.turn === color && s.selected).length;
}

interface Candidate {
  repertoireId: string;
  posKey: string;
  contextKey: string;
  ply: number;
  order: number;
}

/** Positions où l'utilisateur doit jouer un coup sélectionné. */
export function candidatePositions(rc: RepContext): Candidate[] {
  const out = new Map<string, Candidate>();
  let order = 0;
  for (const line of rc.lines) {
    const color = userColorForLine(rc, line);
    line.steps.forEach((s, i) => {
      if (!s.selected || s.turn !== color) return;
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

export function buildQueue(config: SessionConfig, deps: EngineDeps, now: number): QueueItem[] {
  const reps = [...deps.ctx.reps.values()];
  const limit = config.maxQuestions > 0 ? config.maxQuestions : Infinity;
  if (sessionKind(config) === 'lines') {
    const items: Array<{ rc: RepContext; line: Line; fresh: boolean }> = [];
    for (const rc of reps) {
      for (const line of rc.lines) {
        if (config.lineKeys?.length && !config.lineKeys.includes(line.key)) continue;
        if (!lineQuestionCount(rc, line)) continue;
        const color = userColorForLine(rc, line);
        const fresh = line.steps.some((s) => s.selected && s.turn === color && isNew(deps.cards.get(cardId(rc.repertoire.id, s.posKeyBefore))));
        items.push({ rc, line, fresh });
      }
    }
    // Apprendre : les lignes encore jamais vues d'abord, dans l'ordre du répertoire.
    const ordered = config.mode === 'learn' ? [...items.filter((x) => x.fresh), ...items.filter((x) => !x.fresh)] : items;
    return ordered.slice(0, limit).map((x) => ({ kind: 'line', repertoireId: x.rc.repertoire.id, lineKey: x.line.key }));
  }

  // Sessions par positions
  type Scored = Candidate & { score: number; card?: ReviewCard };
  let list: Scored[] = [];
  for (const rc of reps) {
    for (const c of candidatePositions(rc)) {
      const card = deps.cards.get(cardId(rc.repertoire.id, c.posKey));
      list.push({ ...c, card, score: priority(card, now) });
    }
  }
  if (config.mode === 'smart') {
    const due = list.filter((c) => c.card && isDue(c.card, now)).sort((a, b) => b.score - a.score);
    const later = list.filter((c) => c.card && !isDue(c.card, now) && c.card.reviewLater).sort((a, b) => b.score - a.score);
    // Nouvelles positions : d'abord l'arbre principal (depuis la position initiale), du tronc vers les feuilles.
    const isStd = (c: Candidate) => c.contextKey.startsWith('start|');
    const fresh = list
      .filter((c) => isNew(c.card))
      .sort((a, b) => Number(isStd(b)) - Number(isStd(a)) || a.ply - b.ply || a.order - b.order)
      .slice(0, Math.max(0, config.newLimit));
    list = [...due, ...later, ...fresh];
  } else {
    list = list
      .filter((c) => isFragile(c.card, deps.slowMs))
      .map((c) => ({ ...c, score: c.card ? (c.card.errors + c.card.hints * 0.5 + (c.card.reviewLater ? 2 : 0)) / Math.max(1, c.card.attempts) + (c.card.reviewLater ? 1 : 0) : 0 }))
      .sort((a, b) => b.score - a.score);
  }
  return list.slice(0, limit).map((c) => ({ kind: 'position', repertoireId: c.repertoireId, posKey: c.posKey, contextKey: c.contextKey }));
}

/* ------------------------------------------------------------------ */
/* Cycle de vie de la session                                          */
/* ------------------------------------------------------------------ */

export function createSession(config: SessionConfig, deps: EngineDeps, now: number, id: string): EngineResult {
  const queue = buildQueue(config, deps, now);
  const state: SessionState = {
    id,
    config,
    createdAt: now,
    updatedAt: now,
    queue,
    cursor: 0,
    completedLines: [],
    phase: 'finished',
    answered: {},
    stats: emptyStats(),
    mistakes: [],
  };
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
  if (cursor >= state.queue.length) return { state: finish({ ...state, cursor }, now), effects: [] };
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
  const steps = path.slice(1).map((n, i) => ({ uci: n.uci, san: n.san, fenBefore: path[i].fen, fenAfter: n.fen }));
  const item: ItemState = { ...newItem(rc.repertoire.id, path[0].fen, now), posKey: q.posKey, contextSteps: steps };
  const phase = steps.length ? 'auto' : 'question';
  return { state: { ...state, cursor, item, phase, feedback: undefined, updatedAt: now }, effects: [] };
}

export function nextItem(state: SessionState, deps: EngineDeps, now: number): EngineResult {
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

/** Couleur jouée par l'utilisateur pour l'élément en cours (aussi l'orientation de l'échiquier). */
export function currentUserColor(state: SessionState, deps: EngineDeps): Color {
  const rc = currentRep(state, deps);
  if (!rc) return 'w';
  const line = currentLine(state, deps);
  if (line) return userColorForLine(rc, line);
  if (state.item?.posKey) return sideToMove(rc.index.get(state.item.posKey)?.fen ?? currentFen(state));
  return userColorForRepertoire(rc);
}

/** Nom de la ligne ou du chapitre en cours : à n'afficher qu'une fois la question résolue (il contient souvent les coups attendus). */
export function itemLabel(state: SessionState, deps: EngineDeps): string | undefined {
  const rc = currentRep(state, deps);
  if (!rc || !state.item) return undefined;
  const line = currentLine(state, deps);
  if (line) return lineName(line, rc.gameLabel, deps.notation, 5);
  const m = state.item.posKey ? rc.index.get(state.item.posKey)?.moves.find((x) => x.selected) : undefined;
  const gid = m ? rc.forest.byKey.get(m.nodeKeys[0])?.occurrences[0]?.gameId : undefined;
  return gid ? rc.gameLabel(gid) : rc.repertoire.name;
}

export interface QuestionInfo {
  rc: RepContext;
  fen: string;
  posKey: string;
  info?: PositionInfo;
  /** Coups acceptés comme bonne réponse : tous les coups sélectionnés depuis cette position. */
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
  const accepted = (info?.moves ?? []).filter((m) => m.selected);
  let reference: { uci: string; san: string } | undefined;
  const step = line?.steps[item.stepIndex];
  if (step) reference = { uci: step.uci, san: step.san };
  else if (accepted.length) reference = { uci: accepted[0].uci, san: accepted[0].san };
  return { rc, fen, posKey, info, accepted, reference, line, stepIndex: item.stepIndex, cardId: cardId(rc.repertoire.id, posKey) };
}

/* ------------------------------------------------------------------ */
/* Déroulement des lignes                                              */
/* ------------------------------------------------------------------ */

/** Une position déjà réussie dans la session (début commun à plusieurs lignes) n'est pas redemandée. */
function shouldAsk(state: SessionState, rc: RepContext, line: Line, idx: number): boolean {
  const step = line.steps[idx];
  if (!step.selected || step.turn !== userColorForLine(rc, line)) return false;
  return state.answered[cardId(rc.repertoire.id, step.posKeyBefore)] !== 'correct';
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
  if (shouldAsk(state, rc, line, item.stepIndex)) return { state: beginQuestion(state, deps, now), effects: [] };
  return { state: { ...state, phase: 'auto', updatedAt: now }, effects: [] };
}

function completeLine(state: SessionState, deps: EngineDeps, now: number): EngineResult {
  const rc = currentRep(state, deps)!;
  const line = currentLine(state, deps)!;
  const item = state.item!;
  const questions = item.moves.filter((m) => m.by === 'user' && m.result).length;
  const correct = item.moves.filter((m) => m.result === 'correct').length;
  const done = lineCompleteFeedback(correct, questions);
  return {
    state: {
      ...state,
      completedLines: state.completedLines.includes(line.key) ? state.completedLines : [...state.completedLines, line.key],
      phase: 'itemDone',
      feedback: state.config.mode === 'learn' ? { ...done, message: 'Ligne présentée. Elle reviendra bientôt dans la révision du jour.' } : done,
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
      graded: true,
    },
  };
}

function gradeEffect(deps: EngineDeps, q: QuestionInfo, result: AttemptResult, timeMs: number, hints: number, hadError: boolean): { effects: Effect[]; grade?: Grade4 } {
  const card = deps.cards.get(q.cardId);
  if (result === 'learned' && card && !isNew(card)) return { effects: [] };
  const grade = autoGrade(card, { result, timeMs, hints, hadError, errorCountsAsFailure: true, slowMs: deps.slowMs, fastMs: deps.fastMs });
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

/** Gravité d'une erreur, sans nommer le coup attendu (elle peut s'afficher avant la solution). */
function severityFor(q: QuestionInfo, deps: EngineDeps): Feedback['severity'] {
  const card = deps.cards.get(q.cardId);
  const total = q.rc.lines.length || 1;
  const dependent = criticality(q.rc, q.info);
  const knew = card && (card.streak >= 2 || card.fsrs.stability >= 7);
  if (dependent >= Math.max(10, total * 0.25)) return { level: 'critical', text: `Critique : ${dependent} lignes de ta sélection dépendent de ce coup.` };
  if (knew) return { level: 'major', text: 'Importante : tu connaissais ce coup (oubli d’une position maîtrisée).' };
  if (dependent >= 3) return { level: 'major', text: `Importante : ${dependent} lignes dépendent de ce coup.` };
  return { level: 'minor', text: dependent > 1 ? `Mineure : ${dependent} lignes concernées.` : 'Mineure : une seule ligne concernée.' };
}

/** Nom de la variante pour le bilan de fin de session. */
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
    const g = item.graded ? { effects: [] as Effect[], grade: undefined } : gradeEffect(deps, q, result, timeMs, item.hints, item.errors > 0);
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
  }
  let newItem = recordUserMove(state, mv, q.fen, result === 'learned' ? 'learned' : firstTry ? 'correct' : item.revealed ? 'revealed' : 'error');
  newItem = { ...newItem, questionsInItem: newItem.questionsInItem + 1, graded: true, logged: true };
  const fbMv = fbMove(q.fen, mv.san, mv.uci, deps.notation);
  const explanation = q.info?.moves.find((m) => m.uci === mv.uci)?.comments[0];
  let feedback: Feedback | undefined = firstTry ? correctFeedback(deps.style, fbMv, q.cardId + stats.questions, explanation, q.cardId) : undefined;
  if (followed && q.reference) {
    feedback = alternativeFollowedFeedback(fbMv, fbMove(q.fen, q.reference.san, q.reference.uci, deps.notation), q.cardId);
    stats.alternatives++;
  }
  let s: SessionState = { ...state, stats, answered, item: newItem, feedback, updatedAt: now };

  if (state.config.askConfidence && firstTry) {
    s = { ...s, phase: 'feedback', item: { ...s.item!, ...(followed ? { lineKey: followed.lineKey, stepIndex: followed.step + 1 } : q.line ? { stepIndex: item.stepIndex + 1 } : {}) } };
    return { state: s, effects };
  }
  return { state: continueAfterAnswer(s, deps, now, q, followed).state, effects };
}

function continueAfterAnswer(s: SessionState, deps: EngineDeps, now: number, q: QuestionInfo, followed?: { lineKey: string; step: number }): EngineResult {
  if (q.line) {
    const item = s.item!;
    const moved = followed ? { ...item, lineKey: followed.lineKey, stepIndex: followed.step + 1 } : { ...item, stepIndex: item.stepIndex + 1 };
    return advanceLine({ ...s, item: moved }, deps, now);
  }
  return { state: { ...s, phase: 'itemDone', stats: { ...s.stats, itemsDone: s.stats.itemsDone + 1 } }, effects: [{ type: 'touchRepertoire', repertoireId: q.rc.repertoire.id }] };
}

/** Après une note de confiance (ou « continuer » après une bonne réponse en attente). */
export function confirmAnswer(state: SessionState, deps: EngineDeps, now: number, grade?: Grade4): EngineResult {
  if (state.phase !== 'feedback' || state.feedback?.kind === 'error') return { state, effects: [] };
  const effects: Effect[] = [];
  if (grade && state.feedback?.cardId) effects.push({ type: 'regrade', cardId: state.feedback.cardId, grade });
  const item = state.item!;
  if (item.lineKey) {
    const r = advanceLine({ ...state, feedback: state.feedback }, deps, now);
    return { state: r.state, effects: [...effects, ...r.effects] };
  }
  return { state: { ...state, phase: 'itemDone', stats: { ...state.stats, itemsDone: state.stats.itemsDone + 1 } }, effects };
}

function onError(state: SessionState, deps: EngineDeps, q: QuestionInfo, mv: { uci: string; san: string; fenAfter: string }, now: number): EngineResult {
  const item = state.item!;
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
    answered[q.cardId] = 'error';
    let grade: Grade4 | undefined;
    if (!item.graded) {
      const g = gradeEffect(deps, q, 'error', timeMs, item.hints, true);
      effects.push(...g.effects);
      grade = g.grade;
      graded = true;
    }
    effects.push(makeLog(state, q, 'error', timeMs, item.hints, mv, true, grade, now));
    logged = true;
  }
  const errors = item.errors + 1;
  const reveal = !state.config.secondChance || errors > 1 || learning;
  const ref = q.reference && q.accepted.some((m) => m.uci === q.reference!.uci) ? q.reference : q.accepted[0];
  const ordered = ref ? [...q.accepted].sort((a, b) => (a.uci === ref.uci ? -1 : b.uci === ref.uci ? 1 : 0)) : q.accepted;
  const fbExpected = ordered.map((m) => fbMove(q.fen, m.san, m.uci, deps.notation));
  const explanation = ref ? q.info?.moves.find((m) => m.uci === ref.uci)?.comments[0] : undefined;
  let feedback = errorFeedback({
    style: deps.style,
    notation: deps.notation,
    fenBefore: q.fen,
    played: mv,
    expected: fbExpected,
    explanation,
    severity: severityFor(q, deps),
    seed: q.cardId + errors,
    cardId: q.cardId,
  });
  if (!reveal) {
    feedback = {
      ...feedback,
      expected: undefined,
      explanation: undefined,
      message: `Tu as joué ${feedback.played!.label} : ce n’est pas le coup prévu par ton répertoire. Encore un essai avant la solution.`,
    };
  }
  const mistakes =
    first && !learning
      ? [...state.mistakes, { cardId: q.cardId, repertoireId: q.rc.repertoire.id, fen: q.fen, played: mv.san, expected: fbExpected.map((e) => e.label), label: variationNameFor(q, deps) ?? '' }]
      : state.mistakes;
  const newItem: ItemState = { ...item, errors, attempts: item.attempts + 1, graded, logged, revealed: item.revealed || reveal, failed: true };
  return { state: { ...state, stats, answered, mistakes, item: newItem, phase: 'feedback', feedback, updatedAt: now }, effects };
}

function playExpectedAndContinue(state: SessionState, deps: EngineDeps, now: number, q: QuestionInfo): EngineResult {
  const ref = q.reference && q.accepted.some((m) => m.uci === q.reference!.uci) ? q.reference : q.accepted[0] ?? q.reference;
  if (!ref) return { state: { ...state, phase: 'itemDone' }, effects: [] };
  const mv = resolveMove(q.fen, { uci: ref.uci });
  if (!mv) return { state: { ...state, phase: 'itemDone' }, effects: [] };
  const item = recordUserMove(state, mv, q.fen, 'error');
  const s = { ...state, item: { ...item, graded: true, logged: true }, feedback: undefined };
  return continueAfterAnswer(s, deps, now, q);
}

/** Coup joué par l'utilisateur. */
export function submitMove(state: SessionState, deps: EngineDeps, input: MoveInput, now: number): EngineResult & { illegal?: boolean } {
  if (state.phase !== 'question' || !state.item) return { state, effects: [] };
  const q = questionInfo(state, deps);
  if (!q) return { state, effects: [] };
  const mv = resolveMove(q.fen, input);
  if (!mv) return { state: { ...state, feedback: { kind: 'info', title: 'Coup illégal', message: 'Ce coup n’est pas légal dans cette position. Aucune pénalité.' } }, effects: [], illegal: true };

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
  if (state.feedback?.kind !== 'error') return confirmAnswer(state, deps, now);
  const q = questionInfo(state, deps);
  if (!q) return { state, effects: [] };
  const effects: Effect[] = [];
  let s = state;
  if (!state.item.graded) {
    // Erreur sur un coup présenté (mode Apprendre) : la question est notée comme échec.
    const g = gradeEffect(deps, q, 'error', now - state.item.questionStartedAt, state.item.hints, true);
    effects.push(...g.effects);
    s = { ...s, item: { ...s.item!, graded: true } };
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
    const g = gradeEffect(deps, q, 'revealed', timeMs, item.hints + 1, item.errors > 0);
    effects.push(...g.effects);
    grade = g.grade;
  }
  if (!item.logged) {
    effects.push(makeLog(state, q, 'revealed', timeMs, item.hints + 1, undefined, false, grade, now));
    stats = { ...stats, questions: stats.questions + 1, revealed: stats.revealed + 1 };
    answered[q.cardId] = 'error';
  }
  return {
    state: { ...state, stats, answered, phase: 'question', feedback: revealedFeedback(exp, explanation, q.cardId), item: { ...item, revealed: true, graded: true, logged: true, hints: item.hints + 1, failed: true }, updatedAt: now },
    effects,
  };
}

/** Indice : met en évidence la pièce à jouer. */
export function requestHint(state: SessionState, deps: EngineDeps, now: number): SessionState {
  if (state.phase !== 'question' || !state.item) return state;
  const q = questionInfo(state, deps);
  const ref = q?.reference && q.accepted.some((m) => m.uci === q.reference!.uci) ? q.reference : q?.accepted[0];
  if (!ref) return state;
  return {
    ...state,
    stats: { ...state.stats, hints: state.stats.hints + 1 },
    item: { ...state.item, hints: state.item.hints + 1, hintSquare: ref.uci.slice(0, 2) },
    feedback: { kind: 'info', title: 'Indice', message: 'La pièce à jouer est mise en évidence sur l’échiquier.' },
    updatedAt: now,
  };
}

/** Recommencer la ligne (ou la position) en cours : ses positions sont de nouveau demandées. */
export function restartItem(state: SessionState, deps: EngineDeps, now: number): EngineResult {
  const item = state.item;
  if (!item) return { state, effects: [] };
  const answered = { ...state.answered };
  for (const m of item.moves) if (m.by === 'user') delete answered[cardId(item.repertoireId, positionKey(m.fenBefore))];
  const queued = state.queue[state.cursor];
  const reopen = new Set([item.lineKey, queued?.kind === 'line' ? queued.lineKey : undefined]);
  const completedLines = state.completedLines.filter((k) => !reopen.has(k));
  return startItem({ ...state, answered, completedLines, item: undefined }, deps, now);
}

export function endSession(state: SessionState, now: number): SessionState {
  return finish(state, now);
}

export { PAUL };
