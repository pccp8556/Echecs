import { sideToMove, type Color } from '../chess/fen';
import { formatLine, type NotationStyle } from '../chess/notation';
import { mergedPath, type MergedForest, type MergedNode } from './merged';
import type { ResolvedSelection } from './selection';

/** Une étape de ligne : le coup qui mène au nœud `nodeKey`. */
export interface LineStep {
  nodeKey: string;
  san: string;
  uci: string;
  fenBefore: string;
  fenAfter: string;
  posKeyBefore: string;
  /** Camp qui joue ce coup. */
  turn: Color;
  /** Ce coup fait partie de la sélection (sinon : tronc d'approche). */
  selected: boolean;
}

export interface Line {
  /** Clé du nœud final (unique). */
  key: string;
  repertoireId: string;
  rootFen: string;
  steps: LineStep[];
  /** Parties (chapitres) contenant la ligne complète. */
  gameIds: string[];
}

export function lineFromNode(forest: MergedForest, leaf: MergedNode, repertoireId: string, res?: ResolvedSelection): Line {
  const path = mergedPath(forest, leaf.key);
  const root = path[0];
  const steps: LineStep[] = [];
  for (let i = 1; i < path.length; i++) {
    const prev = path[i - 1];
    const n = path[i];
    steps.push({
      nodeKey: n.key,
      san: n.san,
      uci: n.uci,
      fenBefore: prev.fen,
      fenAfter: n.fen,
      posKeyBefore: prev.posKey,
      turn: sideToMove(prev.fen),
      selected: res ? res.selected.has(n.key) : true,
    });
  }
  return { key: leaf.key, repertoireId, rootFen: root.fen, steps, gameIds: [...new Set(leaf.occurrences.map((o) => o.gameId))] };
}

/** Lignes (racine → feuille) couvrant exactement la sélection, sans doublon. */
export function enumerateLines(forest: MergedForest, res: ResolvedSelection, repertoireId: string): Line[] {
  const out: Line[] = [];
  const stack: MergedNode[] = [...forest.roots].reverse();
  while (stack.length) {
    const n = stack.pop()!;
    if (!res.relevant.has(n.key)) continue;
    const kids = n.children.filter((c) => res.relevant.has(c.key));
    if (!kids.length) {
      if (n.parentKey !== null) out.push(lineFromNode(forest, n, repertoireId, res));
      continue;
    }
    for (let i = kids.length - 1; i >= 0; i--) stack.push(kids[i]);
  }
  return out;
}

export function lineText(line: Line, style: NotationStyle, fromStep = 0): string {
  const steps = line.steps.slice(fromStep);
  if (!steps.length) return '';
  return formatLine(
    steps.map((s) => s.san),
    steps[0].fenBefore,
    style,
  );
}

/** Nom court d'une ligne : chapitre + derniers coups distinctifs. */
export function lineName(line: Line, gameLabel: (id: string) => string, style: NotationStyle, tail = 4): string {
  const label = line.gameIds.length ? gameLabel(line.gameIds[0]) : 'Ligne';
  const from = Math.max(0, line.steps.length - tail);
  const end = lineText(line, style, from);
  return end ? `${label} · …${end}` : label;
}

/** Positions où l'utilisateur doit jouer dans la ligne. */
export function userSteps(line: Line, color: Color | 'both', includeTrunk: boolean): number[] {
  const out: number[] = [];
  line.steps.forEach((s, i) => {
    if (color !== 'both' && s.turn !== color) return;
    if (!s.selected && !includeTrunk) return;
    out.push(i);
  });
  return out;
}
