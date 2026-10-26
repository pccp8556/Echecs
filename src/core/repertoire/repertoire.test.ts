import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { parsePgn } from '../pgn/parse';
import { repertoireFromParsed } from './build';
import { buildForest, commonTrunk, detectColor, splitKey, START_ROOT } from './merged';
import { countSelection, fullSelection, onlySubtrees, resolveSelection, toggleSubtree, checkState } from './selection';
import { enumerateLines, lineText, userSteps } from './lines';
import { buildPositionIndex } from './positions';
import { positionKey } from '../chess/fen';

function rep(text: string) {
  const parsed = parsePgn(text);
  return repertoireFromParsed(parsed, { name: 't', source: { kind: 'paste', importedAt: 0, contentHash: '' } });
}

const findKey = (forest: ReturnType<typeof buildForest>, sans: string[], root = START_ROOT) => {
  let n = forest.byKey.get(`${root}|`)!;
  for (const s of sans) {
    const c = n.children.find((x) => x.san === s);
    if (!c) throw new Error(`coup introuvable ${s}`);
    n = c;
  }
  return n.key;
};

describe('arbre fusionné', () => {
  it('fusionne les chapitres qui partagent les mêmes coups', () => {
    const { games } = rep('[Event "A"]\n\n1. e4 c5 2. Nf3 d6 *\n\n[Event "B"]\n\n1. e4 c5 2. Nf3 Nc6 *\n\n[Event "C"]\n\n1. e4 e5 *');
    const forest = buildForest(games);
    const root = forest.roots[0];
    expect(root.children.map((c) => c.san)).toEqual(['e4']);
    const e4 = root.children[0];
    expect(e4.occurrences).toHaveLength(3);
    expect(e4.children.map((c) => c.san)).toEqual(['c5', 'e5']);
    const nf3 = e4.children[0].children[0];
    expect(nf3.children.map((c) => c.san)).toEqual(['d6', 'Nc6']);
  });

  it('relie les transpositions par position', () => {
    const { games } = rep('1. e4 c5 2. Nf3 d6 (2... Nc6 3. d4) 3. d4 * \n\n 1. Nf3 c5 2. e4 d6 3. d4 *');
    const forest = buildForest(games);
    const index = buildPositionIndex(forest);
    const after2d6 = forest.byKey.get(findKey(forest, ['e4', 'c5', 'Nf3', 'd6']))!;
    const nodes = forest.byPos.get(after2d6.posKey)!;
    expect(nodes).toHaveLength(2);
    expect(index.get(after2d6.posKey)!.moves.map((m) => m.san)).toEqual(['d4']);
    expect(index.get(after2d6.posKey)!.moves[0].nodeKeys).toHaveLength(2);
  });

  it('détecte le camp joué (moins de ramifications) et l’en-tête Orientation', () => {
    const white = rep('1. e4 c5 (1... e5 2. Nf3) (1... e6 2. d4) 2. Nf3 *');
    expect(white.repertoire.detectedColor).toBe('w');
    const black = rep('1. e4 c5 2. Nf3 (2. c3 d5) (2. Nc3 Nc6) d6 *');
    expect(black.repertoire.detectedColor).toBe('b');
    const oriented = rep('[Orientation "black"]\n\n1. e4 c5 (1... e5 2. Nf3) 2. Nf3 *');
    expect(detectColor(oriented.games, buildForest(oriented.games))).toBe('b');
  });
});

describe('sélection des variantes', () => {
  const text = readFileSync(new URL('../../../lichess_study_najdorf_by_remsbarber_2026.10.23.pgn', import.meta.url), 'utf8');
  const { repertoire, games } = rep(text);
  const forest = buildForest(games);

  it('reconnaît un répertoire blanc et son tronc commun (6.f4)', () => {
    expect(repertoire.detectedColor).toBe('w');
    const trunk = commonTrunk(forest)!;
    expect(trunk.san).toBe('f4');
    expect(trunk.ply).toBe(11);
  });

  it('sélectionne un PGN entier', () => {
    const res = resolveSelection(forest, fullSelection(repertoire.id));
    const lines = enumerateLines(forest, res, repertoire.id);
    expect(lines.length).toBe(repertoire.stats.lines);
    const c = countSelection(forest, res, 'w');
    expect(c.lines).toBe(lines.length);
    expect(c.userPositions).toBeGreaterThan(100);
  });

  it('respecte une sélection précise (6...e5 7.Cb3 Cbd7 uniquement) sans réviser le reste', () => {
    const k = findKey(forest, ['e4', 'c5', 'Nf3', 'd6', 'd4', 'cxd4', 'Nxd4', 'Nf6', 'Nc3', 'a6', 'f4', 'e5', 'Nb3', 'Nbd7']);
    const sel = onlySubtrees(repertoire.id, [k]);
    const res = resolveSelection(forest, sel);
    const lines = enumerateLines(forest, res, repertoire.id);
    expect(lines.length).toBeGreaterThan(5);
    for (const l of lines) {
      expect(l.key.startsWith(k)).toBe(true);
      // Les coups du tronc d'approche ne sont pas sélectionnés.
      expect(l.steps.slice(0, 13).every((s) => !s.selected)).toBe(true);
      expect(l.steps.slice(13).every((s) => s.selected)).toBe(true);
    }
    // Aucune ligne 6...e6, 6...g6, etc.
    expect(lines.some((l) => l.steps[11]?.san !== 'e5')).toBe(false);
    // Les coups d'approche ne sont pas demandés par défaut.
    const asked = userSteps(lines[0], 'w', false);
    expect(asked.every((i) => i >= 14)).toBe(true);
  });

  it('exclut une sous-variante sans toucher aux données', () => {
    const e5 = findKey(forest, ['e4', 'c5', 'Nf3', 'd6', 'd4', 'cxd4', 'Nxd4', 'Nf6', 'Nc3', 'a6', 'f4', 'e5']);
    const all = resolveSelection(forest, fullSelection(repertoire.id));
    const sel = toggleSubtree(fullSelection(repertoire.id), e5, false);
    const res = resolveSelection(forest, sel);
    expect(res.selected.has(e5)).toBe(false);
    expect(res.selected.size).toBeLessThan(all.selected.size);
    expect(checkState(forest.byKey.get(findKey(forest, ['e4']))!, res)).toBe('partial');
    const lines = enumerateLines(forest, res, repertoire.id);
    expect(lines.some((l) => l.key.startsWith(e5))).toBe(false);
    // La réinclusion d'un sous-arbre plus profond fonctionne.
    const nb3 = findKey(forest, ['e4', 'c5', 'Nf3', 'd6', 'd4', 'cxd4', 'Nxd4', 'Nf6', 'Nc3', 'a6', 'f4', 'e5', 'Nb3', 'Be7']);
    const res2 = resolveSelection(forest, toggleSubtree(sel, nb3, true));
    expect(enumerateLines(forest, res2, repertoire.id).some((l) => l.key.startsWith(nb3))).toBe(true);
  });

  it('restreint aux chapitres choisis et gère les positions FEN', () => {
    const test1 = games.find((g) => g.headers.some(([k, v]) => k === 'ChapterName' && v === 'Test yourself - Position 1'))!;
    const res = resolveSelection(forest, { repertoireId: repertoire.id, games: [test1.id], defaultInclude: true, rules: [] });
    const lines = enumerateLines(forest, res, repertoire.id);
    expect(lines).toHaveLength(1);
    expect(splitKey(lines[0].key).rootKey).toBe(positionKey(test1.root.fen));
    expect(lines[0].steps[0].san).toBe('h3');
    expect(lineText(lines[0], 'fr').startsWith('10.h3 b5 11.O-O-O Dc7')).toBe(true);
  });
});
