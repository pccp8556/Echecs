import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { parsePgn } from '../pgn/parse';
import { repertoireFromParsed } from '../repertoire/build';
import { fullSelection, onlySubtrees, toggleSubtree, type RepertoireSelection } from '../repertoire/selection';
import { buildForest } from '../repertoire/merged';
import { applyReview, newCard, type ReviewCard } from '../srs/srs';
import { buildSessionContext } from './context';
import {
  continueAfterError,
  createSession,
  currentFen,
  questionInfo,
  retry,
  revealSolution,
  runAuto,
  submitMove,
  timeout,
  nextItem,
  confirmAnswer,
  type EngineDeps,
  type EngineResult,
} from './engine';
import { defaultConfig } from './presets';
import { PAUL } from './feedback';
import type { Effect, ReviewMode, SessionConfig } from './types';

function setup(pgn: string, opts: { mode?: ReviewMode; config?: Partial<SessionConfig>; sel?: (id: string, forest: ReturnType<typeof buildForest>) => RepertoireSelection; cards?: (repertoireId: string, ctx: ReturnType<typeof buildSessionContext>) => ReviewCard[] } = {}) {
  const parsed = parsePgn(pgn);
  const { repertoire, games } = repertoireFromParsed(parsed, { name: 't', source: { kind: 'paste', importedAt: 0, contentHash: '' } });
  const forest = buildForest(games);
  const selection = opts.sel ? opts.sel(repertoire.id, forest) : fullSelection(repertoire.id);
  const config = { ...defaultConfig(opts.mode ?? 'full', [selection]), ...opts.config };
  const ctx = buildSessionContext([{ repertoire, games }], [selection]);
  const deps: EngineDeps = { ctx, cards: new Map((opts.cards?.(repertoire.id, ctx) ?? []).map((c) => [c.id, c])), style: 'humorous', notation: 'fr', slowMs: 12000, fastMs: 2000 };
  const r = createSession(config, deps, 1000, 'session-test');
  const auto = runAuto(r.state, deps, 1000);
  return { repertoire, games, forest, deps, state: auto.state, effects: [...r.effects, ...auto.effects], selection };
}

const play = (deps: EngineDeps, res: EngineResult, san: string, now = 2000): EngineResult & { illegal?: boolean } => {
  const r = submitMove(res.state, deps, { san }, now);
  const a = runAuto(r.state, deps, now);
  return { state: a.state, effects: [...r.effects, ...a.effects], illegal: r.illegal };
};

const logs = (effects: Effect[]) => effects.filter((e) => e.type === 'log').map((e) => (e as Extract<Effect, { type: 'log' }>).log);

const WHITE_REP = '[Event "Rep"]\n\n1. e4 e5 (1... c5 2. Nf3 d6 3. d4) 2. Nf3 Nc6 3. Bb5 *';

describe('moteur de révision — validation des coups', () => {
  it('accepte un coup conforme au répertoire', () => {
    const s = setup(WHITE_REP);
    expect(s.state.phase).toBe('question');
    expect(currentFen(s.state)).toContain(' w ');
    const r = play(s.deps, s, 'e4');
    expect(r.state.stats.correct).toBe(1);
    // L'adversaire a répondu automatiquement et une nouvelle question est posée.
    expect(r.state.phase).toBe('question');
    expect(r.state.item!.moves.map((m) => m.san)).toEqual(['e4', 'e5']);
    const l = logs(r.effects);
    expect(l).toHaveLength(1);
    expect(l[0].result).toBe('correct');
    expect(r.effects.some((e) => e.type === 'grade' && e.grade === 3)).toBe(true);
  });

  it('identifie un coup légal absent du répertoire et affiche « Paul aurait trouvé »', () => {
    const s = setup(WHITE_REP);
    const r = play(s.deps, s, 'd4');
    expect(r.state.phase).toBe('feedback');
    const fb = r.state.feedback!;
    expect(fb.kind).toBe('error');
    expect(fb.title).toContain(PAUL);
    expect(fb.message).toBe('Tu as joué 1.d4, mais ton répertoire prévoit 1.e4.');
    expect(fb.expected!.map((e) => e.label)).toEqual(['1.e4']);
    expect(fb.referenceLine).toMatch(/1\.\.\.e5/);
    expect(fb.priorityNote).toMatch(/prioritaires/);
    expect(r.state.stats.errors).toBe(1);
    expect(r.effects.some((e) => e.type === 'grade' && e.grade === 1)).toBe(true);
  });

  it('refuse un coup illégal sans pénalité', () => {
    const s = setup(WHITE_REP);
    const r = play(s.deps, s, 'Ke2');
    expect(r.illegal).toBe(true);
    expect(r.state.phase).toBe('question');
    expect(r.state.stats.errors).toBe(0);
    expect(r.state.feedback?.title).not.toContain(PAUL);
    expect(r.effects).toHaveLength(0);
  });

  it('distingue légal, répertoire et sélection : coup hors sélection non pénalisé', () => {
    const s = setup('1. e4 e5 2. Nf3 (2. Bc4 Nf6) Nc6 *', {
      config: { color: 'w' },
      sel: (id, forest) => {
        const bc4 = [...forest.byKey.values()].find((n) => n.san === 'Bc4')!;
        return toggleSubtree(fullSelection(id), bc4.key, false);
      },
    });
    let r = play(s.deps, s, 'e4');
    r = play(s.deps, r, 'Bc4');
    expect(r.state.feedback!.kind).toBe('outOfSelection');
    expect(r.state.feedback!.title).not.toContain(PAUL);
    expect(r.state.phase).toBe('question');
    expect(r.state.stats.errors).toBe(0);
    r = play(s.deps, r, 'Nf3');
    expect(r.state.stats.correct).toBe(2);
  });

  it('accepte une variante alternative sélectionnée et suit la branche compatible', () => {
    const s = setup('[Event "R"]\n\n1. e4 e5 2. Nf3 (2. Bc4 Nf6 3. d3) Nc6 3. Bb5 *', { config: { order: 'sequential', color: 'w' } });
    let r = play(s.deps, s, 'e4');
    r = play(s.deps, r, 'Bc4');
    expect(r.state.stats.correct).toBe(2);
    expect(r.state.stats.alternatives).toBe(1);
    expect(r.state.item!.moves.at(-1)!.san).toBe('Nf6');
    r = play(s.deps, r, 'd3');
    expect(r.state.phase).toBe('itemDone');
    expect(r.state.completedLines).toHaveLength(1);
  });

  it('en mode strict, une autre variante sélectionnée est refusée sans pénalité', () => {
    const s = setup('1. e4 e5 2. Nf3 (2. Bc4 Nf6 3. d3) Nc6 3. Bb5 *', { mode: 'line', config: { color: 'w' } });
    let r = play(s.deps, s, 'e4');
    r = play(s.deps, r, 'Bc4');
    expect(r.state.feedback!.kind).toBe('alternative');
    expect(r.state.stats.errors).toBe(0);
    expect(r.state.phase).toBe('question');
  });

  it('ne révise pas une variante non sélectionnée', () => {
    const s = setup(WHITE_REP, {
      sel: (id, forest) => onlySubtrees(id, [[...forest.byKey.values()].find((n) => n.san === 'c5')!.key]),
    });
    // Le tronc 1.e4 est joué automatiquement : la première question porte sur 2.Cf3 après 1...c5.
    expect(s.state.item!.moves.map((m) => m.san)).toEqual(['e4', 'c5']);
    expect(s.state.queue).toHaveLength(1);
    let r = play(s.deps, s, 'Nf3');
    r = play(s.deps, r, 'd4');
    expect(r.state.phase).toBe('itemDone');
    const r2 = nextItem(r.state, s.deps, 3000);
    expect(r2.state.phase).toBe('finished');
  });

  it('accepte une transposition : plusieurs branches compatibles avec la même position', () => {
    const pgn = '[Event "A"]\n\n1. e4 c5 2. Nf3 d6 3. d4 *\n\n[Event "B"]\n\n1. Nf3 c5 2. e4 d6 3. c3 *';
    const s = setup(pgn, { mode: 'blind', config: { order: 'sequential', color: 'w' } });
    // Position après 1.e4 c5 2.Cf3 d6 ou 1.Cf3 c5 2.e4 d6 : 3.d4 et 3.c3 sont tous deux corrects.
    const target = s.state.queue.findIndex((q) => q.kind === 'position' && s.deps.ctx.reps.get(q.repertoireId)!.index.get(q.posKey)!.moves.some((m) => m.san === 'c3'));
    expect(target).toBeGreaterThanOrEqual(0);
    let st = s.state;
    for (let i = 0; i < target; i++) st = runAuto(nextItem(st, s.deps, 1000).state, s.deps, 1000).state;
    const q = questionInfo(st, s.deps)!;
    expect(q.accepted.map((m) => m.san).sort()).toEqual(['c3', 'd4']);
    const r = play(s.deps, { state: st, effects: [] }, 'c3');
    expect(r.state.stats.correct).toBe(1);
  });

  it('révise avec les Noirs : l’adversaire (Blancs) joue automatiquement', () => {
    const s = setup('1. e4 c5 2. Nf3 (2. c3 d5) (2. Nc3 Nc6) d6 *');
    expect(s.repertoire.detectedColor).toBe('b');
    expect(s.state.item!.moves.map((m) => m.san)).toEqual(['e4']);
    expect(currentFen(s.state)).toContain(' b ');
    let r = play(s.deps, s, 'c5');
    expect(r.state.phase).toBe('question');
    r = play(s.deps, r, 'd6');
    expect(r.state.phase).toBe('itemDone');
  });

  it('inverse les couleurs : un répertoire blanc révisé côté Noirs', () => {
    const s = setup(WHITE_REP, { config: { color: 'b', order: 'sequential' } });
    expect(currentFen(s.state)).toContain(' b ');
    const q = questionInfo(s.state, s.deps)!;
    expect(q.accepted.map((m) => m.san).sort()).toEqual(['c5', 'e5']);
  });

  it('part d’une position FEN', () => {
    const fen = 'r1bqk2r/1p2bppp/p1np1n2/8/4PB2/1NN5/PPP1Q1PP/R3KB1R w KQkq - 0 10';
    const s = setup(`[SetUp "1"]\n[FEN "${fen}"]\n\n10. h3 b5 11. O-O-O Qc7 12. g4 *`);
    expect(currentFen(s.state)).toBe(fen);
    let r = play(s.deps, s, 'h3');
    expect(r.state.stats.correct).toBe(1);
    r = play(s.deps, r, 'g4');
    expect(r.state.feedback!.kind).toBe('error');
    expect(r.state.feedback!.message).toBe('Tu as joué 11.g4, mais ton répertoire prévoit 11.O-O-O.');
  });

  it('gère une erreur suivie d’une correction (rejouer la position)', () => {
    const s = setup(WHITE_REP);
    let r = play(s.deps, s, 'd4');
    expect(r.state.phase).toBe('feedback');
    r = { state: retry(r.state, 2500), effects: [] };
    expect(r.state.phase).toBe('question');
    r = play(s.deps, r, 'e4', 3000);
    expect(r.state.stats.errors).toBe(1);
    expect(r.state.stats.correct).toBe(0);
    // Une seule entrée de journal pour cette question, et aucune nouvelle note.
    expect(r.effects.filter((e) => e.type === 'grade' || e.type === 'log')).toHaveLength(0);
    expect(r.state.item!.moves.map((m) => m.san)).toEqual(['e4', 'e5']);
  });

  it('seconde tentative sans solution, puis note « Difficile » si l’erreur ne compte pas comme échec', () => {
    const s = setup(WHITE_REP, { config: { onError: { retry: true, revealAfter: 1, stopLine: false, countAsFailure: false } } });
    let r = play(s.deps, s, 'd4');
    expect(r.state.feedback!.expected).toBeUndefined();
    expect(r.state.feedback!.title).toContain(PAUL);
    expect(r.state.feedback!.message).toMatch(/Encore 1 essai/);
    r = { state: retry(r.state, 2500), effects: [] };
    r = play(s.deps, r, 'e4', 3000);
    expect(r.effects.some((e) => e.type === 'grade' && e.grade === 2)).toBe(true);
  });

  it('« Poursuivre » joue le coup attendu ; « Interrompre la ligne » termine la ligne', () => {
    const s = setup(WHITE_REP);
    let r = play(s.deps, s, 'd4');
    const c = continueAfterError(r.state, s.deps, 3000);
    const a = runAuto(c.state, s.deps, 3000);
    expect(a.state.item!.moves.map((m) => m.san)).toEqual(['e4', 'e5']);
    const stop = setup(WHITE_REP, { config: { onError: { retry: true, revealAfter: 0, stopLine: true, countAsFailure: true } } });
    r = play(stop.deps, stop, 'd4');
    const c2 = continueAfterError(r.state, stop.deps, 3000);
    expect(c2.state.phase).toBe('itemDone');
  });

  it('solution révélée : comptée comme échec, pas comme réussite', () => {
    const s = setup(WHITE_REP);
    const rv = revealSolution(s.state, s.deps, 1500);
    expect(rv.state.feedback!.kind).toBe('revealed');
    expect(logs(rv.effects)[0].result).toBe('revealed');
    const r = play(s.deps, rv, 'e4');
    expect(r.state.stats.correct).toBe(0);
    expect(r.state.stats.revealed).toBe(1);
  });

  it('temps écoulé en test chronométré', () => {
    const s = setup(WHITE_REP, { mode: 'timed' });
    const t = timeout(s.state, s.deps, 20000);
    expect(t.state.feedback!.kind).toBe('timeout');
    expect(logs(t.effects)[0].result).toBe('timeout');
    expect(t.state.stats.timeouts).toBe(1);
  });

  it('apprentissage guidé : montre le coup puis le fait rejouer, sans compter de réussite', () => {
    const s = setup(WHITE_REP, { mode: 'learn' });
    expect(s.state.feedback!.kind).toBe('learnShow');
    expect(s.state.feedback!.expected![0].label).toBe('1.e4');
    const r = play(s.deps, s, 'e4');
    expect(r.state.stats.learned).toBe(1);
    expect(r.state.stats.correct).toBe(0);
    expect(logs(r.effects)[0].result).toBe('learned');
  });

  it('demande la confiance et permet de corriger la note', () => {
    const s = setup(WHITE_REP, { config: { askConfidence: true } });
    const r = play(s.deps, s, 'e4');
    expect(r.state.phase).toBe('feedback');
    const c = confirmAnswer(r.state, s.deps, 2500, 4);
    expect(c.effects).toContainEqual({ type: 'regrade', cardId: r.state.feedback!.cardId, grade: 4 });
    const a = runAuto(c.state, s.deps, 2500);
    expect(a.state.phase).toBe('question');
  });

  it('mode intelligent : les positions dues passent avant les nouvelles, puis la limite de nouvelles', () => {
    const base = setup(WHITE_REP, { mode: 'smart' });
    expect(base.state.queue).toHaveLength(5);
    let dueKey = '';
    const s = setup(WHITE_REP, {
      mode: 'smart',
      config: { newLimit: 2 },
      cards: (repId, ctx) => {
        const rc = ctx.reps.get(repId)!;
        const pos = [...rc.index.values()].find((p) => p.moves.some((m) => m.san === 'd4'))!;
        dueKey = pos.posKey;
        const past = 1000 - 30 * 86400000;
        const reviewed = applyReview(newCard(repId, pos.posKey, pos.fen, 'w', '', past), { grade: 3, result: 'correct', timeMs: 1000, hints: 0, now: past, countsInStats: true });
        return [reviewed];
      },
    });
    expect(s.state.queue).toHaveLength(3);
    expect(s.state.queue[0].kind === 'position' && s.state.queue[0].posKey).toBe(dueKey);
    // Le contexte (1.e4 c5 2.Cf3 d6) est rejoué avant la question.
    expect(s.state.item!.moves.map((m) => m.san)).toEqual(['e4', 'c5', 'Nf3', 'd6']);
  });

  it('entraînement libre : vérifie chaque coup et répond avec le répertoire', () => {
    const s = setup(WHITE_REP, { mode: 'free' });
    expect(s.state.phase).toBe('question');
    let r = play(s.deps, s, 'e4');
    expect(r.state.item!.moves.length).toBe(2);
    expect(['e5', 'c5']).toContain(r.state.item!.moves[1].san);
    r = play(s.deps, r, 'h4');
    expect(r.state.feedback!.title).toContain(PAUL);
  });
});

describe('moteur de révision — PGN réel du dépôt', () => {
  const text = readFileSync(new URL('../../../lichess_study_najdorf_by_remsbarber_2026.10.23.pgn', import.meta.url), 'utf8');

  it('révise une variante précise du PGN (Chapitre 4 : 7...Fe7) avec les Blancs', () => {
    const s = setup(text, {
      config: { order: 'sequential' },
      sel: (id, forest) => {
        let n = forest.roots[0];
        for (const san of ['e4', 'c5', 'Nf3', 'd6', 'd4', 'cxd4', 'Nxd4', 'Nf6', 'Nc3', 'a6', 'f4', 'e5', 'Nb3', 'Be7']) n = n.children.find((c) => c.san === san)!;
        return onlySubtrees(id, [n.key]);
      },
    });
    expect(s.state.phase).toBe('question');
    expect(s.state.item!.moves).toHaveLength(14);
    const q = questionInfo(s.state, s.deps)!;
    expect(q.accepted.map((m) => m.san)).toEqual(['fxe5']);
    let r = play(s.deps, s, 'fxe5');
    expect(r.state.stats.correct).toBe(1);
    r = play(s.deps, r, 'Qd2');
    expect(r.state.feedback!.kind).toBe('error');
    expect(r.state.feedback!.message).toContain('9.Dxd8+');
    expect(r.state.feedback!.variationName).toMatch(/Chapter 4/);
  });

  it('construit une session complète sur les 44 chapitres', () => {
    const s = setup(text);
    expect(s.state.queue.length).toBeGreaterThan(100);
    expect(s.state.phase).toBe('question');
    expect(currentFen(s.state)).toBe('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
  });
});
