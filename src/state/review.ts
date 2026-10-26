import { create } from 'zustand';
import * as engine from '../core/review/engine';
import type { EngineDeps, EngineResult, MoveInput } from '../core/review/engine';
import { buildSessionContext } from '../core/review/context';
import type { Effect, SessionConfig, SessionState } from '../core/review/types';
import { answersSignature } from '../core/repertoire/positions';
import { newCard, type Grade4, type ReviewCard } from '../core/srs/srs';
import { sideToMove } from '../core/chess/fen';
import { newId } from '../core/repertoire/build';
import * as repo from '../storage/repo';
import { useLibrary } from './library';
import { useSettings } from './settings';

type Action =
  | { type: 'move'; move: MoveInput }
  | { type: 'auto' }
  | { type: 'hint' }
  | { type: 'reveal' }
  | { type: 'retry' }
  | { type: 'continue' }
  | { type: 'confirm'; grade?: Grade4 }
  | { type: 'next' }
  | { type: 'restart' }
  | { type: 'skip' }
  | { type: 'timeout' }
  | { type: 'takeBack' }
  | { type: 'rate'; cardId: string; grade: Grade4 }
  | { type: 'end' };

interface LastGrade {
  cardId: string;
  before: ReviewCard | undefined;
  request: repo.GradeRequest;
}

interface ReviewStore {
  session?: SessionState;
  deps?: EngineDeps;
  status: 'idle' | 'loading' | 'ready' | 'error';
  error?: string;
  lastIllegal: number;
  lastError: number;
  /** Dernière bonne réponse notée automatiquement (peut être corrigée par l'utilisateur). */
  lastGraded?: { cardId: string; grade: Grade4; at: number };
  start: (config: SessionConfig) => Promise<string>;
  resume: (id: string) => Promise<void>;
  act: (a: Action) => void;
  clear: () => void;
  updateCard: (cardId: string, fn: (c: ReviewCard) => ReviewCard) => Promise<void>;
}

let effectChain: Promise<void> = Promise.resolve();
let lastGrade: LastGrade | null = null;
let saveTimer: ReturnType<typeof setTimeout> | null = null;

function persist(s: SessionState, immediate = false) {
  if (saveTimer) clearTimeout(saveTimer);
  const run = () => {
    repo.saveSession(s).catch((e) => console.error('Sauvegarde de session impossible', e));
  };
  if (immediate) run();
  else saveTimer = setTimeout(run, 250);
}

async function buildDeps(config: SessionConfig): Promise<EngineDeps> {
  const lib = useLibrary.getState();
  await lib.load();
  const data = [];
  for (const sel of config.selections) {
    const rep = useLibrary.getState().repertoires.find((r) => r.id === sel.repertoireId);
    if (!rep) continue;
    const games = await useLibrary.getState().loadGames(rep.id);
    data.push({ repertoire: rep, games });
  }
  if (!data.length) throw new Error('Aucun des répertoires de cette session n’existe encore.');
  const ctx = buildSessionContext(data, config.selections);
  const s = useSettings.getState().settings;
  return {
    ctx,
    cards: new Map(useLibrary.getState().cards),
    style: s.feedbackStyle,
    notation: s.notation,
    slowMs: s.slowMs,
    fastMs: s.fastMs,
  };
}

function applyEffects(effects: Effect[], deps: EngineDeps) {
  if (!effects.length) return;
  effectChain = effectChain
    .then(async () => {
      const logs = [];
      for (const e of effects) {
        if (e.type === 'log') logs.push(e.log);
        else if (e.type === 'grade') {
          const rc = deps.ctx.reps.get(e.repertoireId);
          const info = rc?.index.get(e.posKey);
          const req: repo.GradeRequest = {
            cardId: e.cardId,
            repertoireId: e.repertoireId,
            posKey: e.posKey,
            fen: e.fen,
            turn: e.turn,
            answers: info ? answersSignature(info) : '',
            grade: e.grade,
            result: e.result,
            timeMs: e.timeMs,
            hints: e.hints,
            now: Date.now(),
            countsInStats: e.countsInStats,
          };
          const { before, after } = await repo.gradeCard(req);
          lastGrade = { cardId: e.cardId, before, request: req };
          deps.cards.set(after.id, after);
          useLibrary.getState().setCards([after]);
          if (e.result === 'correct') useReview.setState({ lastGraded: { cardId: e.cardId, grade: e.grade, at: Date.now() } });
          else useReview.setState({ lastGraded: undefined });
        } else if (e.type === 'regrade') {
          if (!lastGrade || lastGrade.cardId !== e.cardId) continue;
          const lg = lastGrade;
          if (lg.before) await repo.putCards([lg.before]);
          else {
            // La carte n'existait pas : on repart d'une carte neuve.
            const fresh = newCard(lg.request.repertoireId, lg.request.posKey, lg.request.fen, lg.request.turn, lg.request.answers, lg.request.now);
            await repo.putCards([fresh]);
          }
          const { after } = await repo.gradeCard({ ...lg.request, grade: e.grade });
          const withConfidence = { ...after, confidence: e.grade };
          await repo.putCards([withConfidence]);
          deps.cards.set(withConfidence.id, withConfidence);
          useLibrary.getState().setCards([withConfidence]);
          const lgNow = useReview.getState().lastGraded;
          if (lgNow?.cardId === e.cardId) useReview.setState({ lastGraded: { ...lgNow, grade: e.grade } });
        } else if (e.type === 'touchRepertoire') {
          await useLibrary.getState().updateMeta(e.repertoireId, { lastReviewedAt: Date.now() });
        }
      }
      if (logs.length) await repo.addLogs(logs);
    })
    .catch((err) => console.error('Enregistrement de la progression impossible', err));
}

export const useReview = create<ReviewStore>((set, get) => ({
  status: 'idle',
  lastIllegal: 0,
  lastError: 0,
  start: async (config) => {
    set({ status: 'loading', error: undefined, session: undefined });
    try {
      const deps = await buildDeps(config);
      const id = newId();
      const r = engine.createSession(config, deps, Date.now(), id);
      applyEffects(r.effects, deps);
      set({ session: r.state, deps, status: 'ready' });
      persist(r.state, true);
      return id;
    } catch (e) {
      set({ status: 'error', error: e instanceof Error ? e.message : String(e) });
      throw e;
    }
  },
  resume: async (id) => {
    if (get().session?.id === id && get().deps) return;
    set({ status: 'loading', error: undefined });
    try {
      const s = await repo.getSession(id);
      if (!s) throw new Error('Session introuvable : elle a peut-être été supprimée.');
      const deps = await buildDeps(s.config);
      let state = s;
      // Si le répertoire a changé depuis, on repart de l'élément courant.
      if (state.phase !== 'finished' && state.item) {
        const rc = deps.ctx.reps.get(state.item.repertoireId);
        const lineOk = !state.item.lineKey || rc?.linesByKey.has(state.item.lineKey);
        if (!rc || !lineOk) state = engine.startItem({ ...state, item: undefined }, deps, Date.now()).state;
        else if (state.phase === 'question') state = { ...state, item: { ...state.item, questionStartedAt: Date.now() } };
      }
      set({ session: state, deps, status: 'ready' });
    } catch (e) {
      set({ status: 'error', error: e instanceof Error ? e.message : String(e) });
    }
  },
  act: (a) => {
    const { session, deps } = get();
    if (!session || !deps) return;
    const now = Date.now();
    let r: EngineResult & { illegal?: boolean };
    switch (a.type) {
      case 'move':
        r = engine.submitMove(session, deps, a.move, now);
        break;
      case 'auto':
        r = engine.stepAuto(session, deps, now);
        break;
      case 'hint':
        r = { state: engine.requestHint(session, deps, now), effects: [] };
        break;
      case 'reveal':
        r = engine.revealSolution(session, deps, now);
        break;
      case 'retry':
        r = { state: engine.retry(session, now), effects: [] };
        break;
      case 'continue':
        r = engine.continueAfterError(session, deps, now);
        break;
      case 'confirm':
        r = engine.confirmAnswer(session, deps, now, a.grade);
        break;
      case 'next':
        r = engine.nextItem(session, deps, now);
        break;
      case 'restart':
        r = engine.restartItem(session, deps, now);
        break;
      case 'skip':
        r = engine.skipItem(session, deps, now);
        break;
      case 'timeout':
        r = engine.timeout(session, deps, now);
        break;
      case 'takeBack':
        r = { state: engine.takeBack(session, deps, now), effects: [] };
        break;
      case 'end':
        r = { state: engine.endSession(session, now), effects: [] };
        break;
      case 'rate':
        r = { state: session, effects: session.config.graded ? [{ type: 'regrade', cardId: a.cardId, grade: a.grade }] : [] };
        break;
    }
    applyEffects(r.effects, deps);
    const patch: Partial<ReviewStore> = { session: r.state };
    if (r.illegal) patch.lastIllegal = now;
    if (r.state.feedback?.kind === 'error' && r.state.feedback !== session.feedback) patch.lastError = now;
    set(patch);
    persist(r.state, r.state.phase === 'finished');
  },
  clear: () => set({ session: undefined, deps: undefined, status: 'idle' }),
  updateCard: async (cardId, fn) => {
    const { deps, session } = get();
    const repId = cardId.slice(0, cardId.indexOf('|'));
    const posKey = cardId.slice(cardId.indexOf('|') + 1);
    let card = (await repo.getCards(repId)).find((c) => c.id === cardId);
    if (!card) {
      const rc = deps?.ctx.reps.get(repId);
      const info = rc?.index.get(posKey);
      const fen = info?.fen ?? (session ? engine.currentFen(session) : '');
      card = newCard(repId, posKey, fen, sideToMove(fen || 'x w'), info ? answersSignature(info) : '', Date.now());
    }
    const next = fn(card);
    await repo.putCards([next]);
    deps?.cards.set(next.id, next);
    useLibrary.getState().setCards([next]);
  },
}));
