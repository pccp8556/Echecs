import type { Color } from '../chess/fen';
import { turnAt, type MergedForest, type MergedNode } from './merged';
import type { LineMark } from './types';

/**
 * Sélection de ce qu'on veut réviser dans un répertoire.
 *
 * - `games` restreint aux parties (chapitres) choisies.
 * - `rules` coche / décoche des sous-arbres de l'arbre fusionné : la règle la
 *   plus proche (ancêtre ou nœud lui-même) l'emporte ; sans règle, `defaultInclude`.
 * - Les lignes marquées « abandonnées » sont exclues sauf `includeAbandoned`.
 *
 * Un nœud est « sélectionné » quand le coup qui y mène fait partie de la
 * révision. Ses ancêtres non sélectionnés forment le tronc d'approche : ils sont
 * joués pour atteindre la sélection, sans être notés (sauf option contraire).
 */
export interface SelectionRule {
  key: string;
  include: boolean;
}

export interface RepertoireSelection {
  repertoireId: string;
  games: 'all' | string[];
  defaultInclude: boolean;
  rules: SelectionRule[];
  includeAbandoned?: boolean;
}

export function fullSelection(repertoireId: string): RepertoireSelection {
  return { repertoireId, games: 'all', defaultInclude: true, rules: [] };
}

export interface ResolvedSelection {
  /** Nœuds dont le coup fait partie de la révision. */
  selected: Set<string>;
  /** Nœuds sélectionnés ou ayant un descendant sélectionné (tronc compris). */
  relevant: Set<string>;
}

export function resolveSelection(forest: MergedForest, sel: RepertoireSelection, marks: Record<string, LineMark> = {}): ResolvedSelection {
  const rules = new Map(sel.rules.map((r) => [r.key, r.include]));
  const gameSet = sel.games === 'all' ? null : new Set(sel.games);
  const selected = new Set<string>();
  const relevant = new Set<string>();

  const visit = (n: MergedNode, inherited: boolean, isRoot: boolean): boolean => {
    let inc = rules.has(n.key) ? rules.get(n.key)! : inherited;
    if (!sel.includeAbandoned && marks[n.key] === 'abandoned') inc = false;
    const inGames = !gameSet || n.occurrences.some((o) => gameSet.has(o.gameId));
    if (!inGames) return false;
    const isSel = inc && !isRoot;
    if (isSel) selected.add(n.key);
    let any = isSel;
    for (const c of n.children) if (visit(c, inc, false)) any = true;
    if (any) relevant.add(n.key);
    return any;
  };
  for (const r of forest.roots) visit(r, sel.defaultInclude, true);
  return { selected, relevant };
}

/** État de la case à cocher d'un nœud dans l'arborescence. */
export type CheckState = 'checked' | 'unchecked' | 'partial';

export function checkState(n: MergedNode, res: ResolvedSelection): CheckState {
  const self = n.parentKey === null ? res.relevant.has(n.key) : res.selected.has(n.key);
  let total = 0;
  let sel = 0;
  const stack = [...n.children];
  while (stack.length) {
    const c = stack.pop()!;
    total++;
    if (res.selected.has(c.key)) sel++;
    stack.push(...c.children);
  }
  if (n.parentKey === null) {
    if (total === 0) return self ? 'checked' : 'unchecked';
    return sel === total ? 'checked' : sel === 0 ? 'unchecked' : 'partial';
  }
  if (self && sel === total) return 'checked';
  if (!self && sel === 0) return 'unchecked';
  return 'partial';
}

/**
 * Coche ou décoche un sous-arbre. Les règles plus profondes de ce sous-arbre
 * sont supprimées afin que le choix s'applique à toute la branche.
 */
export function toggleSubtree(sel: RepertoireSelection, key: string, include: boolean): RepertoireSelection {
  const rules = sel.rules.filter((r) => !(r.key === key || r.key.startsWith(key.endsWith('|') ? key : key + ' ')));
  // Pour une racine (« start| »), le préfixe couvre tout l'arbre de cette racine.
  rules.push({ key, include });
  return { ...sel, rules };
}

/** Ne garder que les sous-arbres choisis (le reste est décoché). */
export function onlySubtrees(repertoireId: string, keys: string[]): RepertoireSelection {
  return { repertoireId, games: 'all', defaultInclude: false, rules: keys.map((key) => ({ key, include: true })) };
}

export interface SelectionCounts {
  lines: number;
  positions: number;
  userPositions: number;
  moves: number;
}

/** Compte les lignes, positions et coups à jouer pour l'utilisateur dans la sélection. */
export function countSelection(forest: MergedForest, res: ResolvedSelection, userColor: Color | 'both'): SelectionCounts {
  const positions = new Set<string>();
  const userPositions = new Set<string>();
  let lines = 0;
  let moves = 0;
  for (const key of res.selected) {
    const n = forest.byKey.get(key)!;
    moves++;
    const parent = n.parentKey ? forest.byKey.get(n.parentKey) : undefined;
    if (parent) {
      positions.add(parent.posKey);
      if (userColor === 'both' || turnAt(parent) === userColor) userPositions.add(parent.posKey);
    }
    if (!n.children.some((c) => res.relevant.has(c.key))) lines++;
  }
  return { lines, positions: positions.size, userPositions: userPositions.size, moves };
}

/** Clés de règles qui ne correspondent plus à aucun nœud (après modification du PGN). */
export function staleRules(forest: MergedForest, sel: RepertoireSelection): string[] {
  return sel.rules.filter((r) => !forest.byKey.has(r.key)).map((r) => r.key);
}
