import { isStartPosition, positionKey, sideToMove, type Color } from '../chess/fen';
import type { MoveNode, Shape } from '../pgn/types';
import type { GameRecord } from './types';

/**
 * Arbre fusionné d'un répertoire : toutes les parties (chapitres) sont réunies
 * par séquence de coups depuis leur position de départ. Deux chapitres qui
 * commencent par 1.e4 c5 2.Cf3 partagent donc les mêmes nœuds. Les
 * transpositions (même position atteinte par des ordres de coups différents)
 * restent des nœuds distincts mais sont reliées par `byPos`.
 */

export interface Occurrence {
  gameId: string;
  nodeId: number;
}

export interface MergedNode {
  key: string;
  parentKey: string | null;
  rootKey: string;
  san: string;
  uci: string;
  /** FEN après le coup (ou FEN de départ pour une racine). */
  fen: string;
  posKey: string;
  ply: number;
  children: MergedNode[];
  occurrences: Occurrence[];
  /** Nombre de parties où ce coup est la suite principale. */
  mainCount: number;
  nags: number[];
  comments: Array<{ gameId: string; text: string }>;
  shapes: Shape[];
}

export interface MergedForest {
  roots: MergedNode[];
  byKey: Map<string, MergedNode>;
  byPos: Map<string, MergedNode[]>;
}

export const START_ROOT = 'start';

export function rootKeyOf(fen: string): string {
  return isStartPosition(fen) ? START_ROOT : positionKey(fen);
}

export function childKey(parentKey: string, uci: string): string {
  return parentKey.endsWith('|') ? parentKey + uci : `${parentKey} ${uci}`;
}

export function rootNodeKey(rootKey: string): string {
  return `${rootKey}|`;
}

export function splitKey(key: string): { rootKey: string; ucis: string[] } {
  const i = key.indexOf('|');
  const rootKey = key.slice(0, i);
  const rest = key.slice(i + 1).trim();
  return { rootKey, ucis: rest ? rest.split(' ') : [] };
}

export function isAncestorKey(ancestor: string, key: string): boolean {
  if (ancestor === key) return true;
  if (!key.startsWith(ancestor)) return false;
  return ancestor.endsWith('|') || key[ancestor.length] === ' ';
}

export function buildForest(games: GameRecord[]): MergedForest {
  const byKey = new Map<string, MergedNode>();
  const byPos = new Map<string, MergedNode[]>();
  const roots: MergedNode[] = [];
  const register = (n: MergedNode) => {
    byKey.set(n.key, n);
    const list = byPos.get(n.posKey);
    if (list) list.push(n);
    else byPos.set(n.posKey, [n]);
  };

  for (const g of games) {
    if (g.fatal) continue;
    const rk = rootKeyOf(g.root.fen);
    const rkey = rootNodeKey(rk);
    let root = byKey.get(rkey);
    if (!root) {
      root = {
        key: rkey,
        parentKey: null,
        rootKey: rk,
        san: '',
        uci: '',
        fen: g.root.fen,
        posKey: positionKey(g.root.fen),
        ply: 0,
        children: [],
        occurrences: [],
        mainCount: 0,
        nags: [],
        comments: [],
        shapes: [],
      };
      register(root);
      if (rk === START_ROOT) roots.unshift(root);
      else roots.push(root);
    }
    root.occurrences.push({ gameId: g.id, nodeId: 0 });
    for (const c of g.root.comments ?? []) root.comments.push({ gameId: g.id, text: c });

    const stack: Array<[MoveNode, MergedNode, boolean]> = [];
    for (let i = g.root.children.length - 1; i >= 0; i--) stack.push([g.root.children[i], root, i === 0]);
    while (stack.length) {
      const [node, parent, isMain] = stack.pop()!;
      if (node.invalid) continue;
      const key = childKey(parent.key, node.uci);
      let m = byKey.get(key);
      if (!m) {
        m = {
          key,
          parentKey: parent.key,
          rootKey: rk,
          san: node.san,
          uci: node.uci,
          fen: node.fen,
          posKey: positionKey(node.fen),
          ply: parent.ply + 1,
          children: [],
          occurrences: [],
          mainCount: 0,
          nags: [],
          comments: [],
          shapes: node.shapes ?? [],
        };
        register(m);
        parent.children.push(m);
      }
      m.occurrences.push({ gameId: g.id, nodeId: node.id });
      if (isMain) m.mainCount++;
      for (const n of node.nags ?? []) if (!m.nags.includes(n)) m.nags.push(n);
      for (const c of [...(node.commentsBefore ?? []), ...(node.comments ?? [])]) m.comments.push({ gameId: g.id, text: c });
      for (let i = node.children.length - 1; i >= 0; i--) stack.push([node.children[i], m, i === 0]);
    }
  }
  // Les suites principales d'abord (stable pour le reste).
  for (const n of byKey.values()) {
    if (n.children.length > 1) {
      n.children = n.children
        .map((c, i) => ({ c, i }))
        .sort((a, b) => b.c.mainCount - a.c.mainCount || a.i - b.i)
        .map((x) => x.c);
    }
  }
  return { roots, byKey, byPos };
}

/** Chemin (nœuds, racine incluse) jusqu'au nœud fusionné `key`. */
export function mergedPath(forest: MergedForest, key: string): MergedNode[] {
  const out: MergedNode[] = [];
  let cur = forest.byKey.get(key);
  while (cur) {
    out.unshift(cur);
    cur = cur.parentKey ? forest.byKey.get(cur.parentKey) : undefined;
  }
  return out;
}

export function turnAt(node: MergedNode): Color {
  return sideToMove(node.fen);
}

/** Nombre de feuilles (lignes) sous chaque nœud, calculé une fois. */
export function leafCounts(forest: MergedForest): Map<string, number> {
  const out = new Map<string, number>();
  const visit = (n: MergedNode): number => {
    if (!n.children.length) {
      out.set(n.key, 1);
      return 1;
    }
    let s = 0;
    for (const c of n.children) s += visit(c);
    out.set(n.key, s);
    return s;
  };
  for (const r of forest.roots) visit(r);
  return out;
}

/**
 * Détecte le camp joué : dans un répertoire, on prévoit généralement un seul
 * coup pour son propre camp et plusieurs réponses pour l'adversaire. L'en-tête
 * Lichess « Orientation » est prioritaire lorsqu'il est présent.
 */
export function detectColor(games: GameRecord[], forest: MergedForest): Color {
  const orientations = games
    .map((g) => g.headers.find(([k]) => k === 'Orientation')?.[1]?.toLowerCase())
    .filter((o): o is string => o === 'white' || o === 'black');
  if (orientations.length) {
    const w = orientations.filter((o) => o === 'white').length;
    return w >= orientations.length - w ? 'w' : 'b';
  }
  const score: Record<Color, { branch: number; total: number }> = { w: { branch: 0, total: 0 }, b: { branch: 0, total: 0 } };
  for (const n of forest.byKey.values()) {
    if (!n.children.length) continue;
    const t = turnAt(n);
    score[t].total++;
    if (n.children.length > 1) score[t].branch += n.children.length - 1;
  }
  const rw = score.w.total ? score.w.branch / score.w.total : 0;
  const rb = score.b.total ? score.b.branch / score.b.total : 0;
  // Le camp qui se ramifie le moins est celui de l'utilisateur.
  return rw <= rb ? 'w' : 'b';
}

/** Position la plus profonde commune à toutes les parties partant de la position initiale. */
export function commonTrunk(forest: MergedForest): MergedNode | null {
  const root = forest.roots.find((r) => r.rootKey === START_ROOT) ?? forest.roots[0];
  if (!root) return null;
  let cur = root;
  while (cur.children.length === 1) cur = cur.children[0];
  return cur;
}
