import { Chess } from 'chess.js';
import { positionKey } from '../chess/fen';
import type { GameRoot, MoveNode } from './types';

export type TreeNode = GameRoot | MoveNode;

export function isMoveNode(n: TreeNode): n is MoveNode {
  return (n as MoveNode).id !== undefined && (n as MoveNode).san !== undefined;
}

export interface TreeCounts {
  moves: number;
  lines: number;
  variations: number;
  comments: number;
  shapes: number;
  invalid: number;
  maxDepth: number;
  positionKeys: Set<string>;
}

/** Statistiques d'un arbre de coups (itératif pour supporter les très longues parties). */
export function countTree(root: GameRoot): TreeCounts {
  const out: TreeCounts = { moves: 0, lines: 0, variations: 0, comments: 0, shapes: 0, invalid: 0, maxDepth: 0, positionKeys: new Set() };
  out.comments += root.comments?.length ?? 0;
  out.shapes += root.shapes?.length ?? 0;
  const stack: Array<[MoveNode, number]> = root.children.map((c) => [c, 1]);
  out.variations += Math.max(0, root.children.length - 1);
  if (root.children.length === 0) out.lines = 0;
  while (stack.length) {
    const [n, depth] = stack.pop()!;
    if (n.invalid) {
      out.invalid++;
      continue;
    }
    out.moves++;
    out.maxDepth = Math.max(out.maxDepth, depth);
    out.positionKeys.add(positionKey(n.fen));
    out.comments += (n.comments?.length ?? 0) + (n.commentsBefore?.length ?? 0);
    out.shapes += n.shapes?.length ?? 0;
    const valid = n.children.filter((c) => !c.invalid);
    if (valid.length === 0) out.lines++;
    out.variations += Math.max(0, n.children.length - 1);
    for (const c of n.children) stack.push([c, depth + 1]);
  }
  return out;
}

/** Parcours en profondeur avec le chemin (liste des nœuds depuis la racine). */
export function walk(root: GameRoot, visit: (node: MoveNode, path: MoveNode[]) => void | 'skip'): void {
  const stack: Array<[MoveNode, MoveNode[]]> = [];
  for (let i = root.children.length - 1; i >= 0; i--) stack.push([root.children[i], []]);
  while (stack.length) {
    const [n, parents] = stack.pop()!;
    const path = [...parents, n];
    if (visit(n, path) === 'skip') continue;
    for (let i = n.children.length - 1; i >= 0; i--) stack.push([n.children[i], path]);
  }
}

/** Retourne le chemin [racine exclue] menant au nœud d'identifiant `id`. */
export function findPath(root: GameRoot, id: number): MoveNode[] | null {
  let found: MoveNode[] | null = null;
  walk(root, (n, path) => {
    if (found) return 'skip';
    if (n.id === id) found = path;
  });
  return found;
}

export function findNode(root: GameRoot, id: number): MoveNode | null {
  const p = findPath(root, id);
  return p ? p[p.length - 1] : null;
}

/** Suit une suite de coups UCI depuis la racine. */
export function nodeByUciPath(root: GameRoot, ucis: string[]): MoveNode[] | null {
  const out: MoveNode[] = [];
  let cur: TreeNode = root;
  for (const u of ucis) {
    const next: MoveNode | undefined = cur.children.find((c) => !c.invalid && c.uci === u);
    if (!next) return null;
    out.push(next);
    cur = next;
  }
  return out;
}

export function maxNodeId(root: GameRoot): number {
  let max = 0;
  walk(root, (n) => {
    if (n.id > max) max = n.id;
  });
  return max;
}

export function cloneRoot(root: GameRoot): GameRoot {
  return structuredClone(root);
}

/**
 * Applique une transformation immuable au nœud `id` (ou à la racine si id = 0).
 * Seuls les nœuds sur le chemin sont recopiés.
 */
export function updateNode(root: GameRoot, id: number, fn: (n: TreeNode) => TreeNode): GameRoot {
  if (id === 0) return fn(root) as GameRoot;
  const path = findPath(root, id);
  if (!path) return root;
  const rebuild = (parent: TreeNode, depth: number): TreeNode => {
    const target = path[depth];
    const children = parent.children.map((c) => {
      if (c !== target) return c;
      if (depth === path.length - 1) return fn(c) as MoveNode;
      return rebuild(c, depth + 1) as MoveNode;
    });
    return { ...parent, children };
  };
  return rebuild(root, 0) as GameRoot;
}

/** Parent (racine ou nœud) d'un nœud. */
export function parentOf(root: GameRoot, id: number): TreeNode | null {
  const path = findPath(root, id);
  if (!path) return null;
  return path.length >= 2 ? path[path.length - 2] : root;
}

/** Ajoute (ou retrouve) un coup après le nœud `parentId`. Retourne le nouvel arbre et l'id du coup. */
export function addMove(
  root: GameRoot,
  parentId: number,
  move: { from: string; to: string; promotion?: string } | string,
  nextId: number,
): { root: GameRoot; id: number; created: boolean } | { error: string } {
  const parent: TreeNode | null = parentId === 0 ? root : findNode(root, parentId);
  if (!parent) return { error: 'Position introuvable' };
  if (isMoveNode(parent) && parent.invalid) return { error: 'Impossible d’ajouter un coup après un coup invalide' };
  const chess = new Chess(parent.fen);
  let mv;
  try {
    mv = chess.move(move, { strict: false });
  } catch {
    return { error: 'Coup illégal' };
  }
  const uci = mv.from + mv.to + (mv.promotion ?? '');
  const existing = parent.children.find((c) => !c.invalid && c.uci === uci);
  if (existing) return { root, id: existing.id, created: false };
  const node: MoveNode = { id: nextId, san: mv.san, uci, fen: mv.after, children: [] };
  const updated = updateNode(root, parentId, (p) => ({ ...p, children: [...p.children, node] }));
  return { root: updated, id: nextId, created: true };
}

/** Supprime un coup et toute sa suite. */
export function deleteNode(root: GameRoot, id: number): GameRoot {
  const parent = parentOf(root, id);
  if (!parent) return root;
  const parentId = isMoveNode(parent) ? parent.id : 0;
  return updateNode(root, parentId, (p) => ({ ...p, children: p.children.filter((c) => c.id !== id) }));
}

/** Fait de la variante `id` la suite principale de son parent. */
export function promoteNode(root: GameRoot, id: number): GameRoot {
  const parent = parentOf(root, id);
  if (!parent) return root;
  const parentId = isMoveNode(parent) ? parent.id : 0;
  return updateNode(root, parentId, (p) => {
    const target = p.children.find((c) => c.id === id);
    if (!target) return p;
    return { ...p, children: [target, ...p.children.filter((c) => c.id !== id)] };
  });
}

/** Déplace une variante d'un cran vers le haut / le bas parmi ses sœurs. */
export function moveVariation(root: GameRoot, id: number, delta: -1 | 1): GameRoot {
  const parent = parentOf(root, id);
  if (!parent) return root;
  const parentId = isMoveNode(parent) ? parent.id : 0;
  return updateNode(root, parentId, (p) => {
    const idx = p.children.findIndex((c) => c.id === id);
    const to = idx + delta;
    if (idx < 0 || to < 0 || to >= p.children.length) return p;
    const children = [...p.children];
    [children[idx], children[to]] = [children[to], children[idx]];
    return { ...p, children };
  });
}

/** Coups (nœuds) de la ligne principale à partir d'un nœud. */
export function mainline(from: TreeNode): MoveNode[] {
  const out: MoveNode[] = [];
  let cur = from.children[0];
  while (cur && !cur.invalid) {
    out.push(cur);
    cur = cur.children[0];
  }
  return out;
}

/** Nombre de nœuds dans le sous-arbre (coups valides). */
export function subtreeSize(n: TreeNode): number {
  let count = 0;
  const stack = [...n.children];
  while (stack.length) {
    const c = stack.pop()!;
    if (c.invalid) continue;
    count++;
    stack.push(...c.children);
  }
  return count;
}
