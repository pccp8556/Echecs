import { sideToMove, type Color } from '../chess/fen';
import type { MergedForest } from './merged';
import type { ResolvedSelection } from './selection';

/** Un coup prévu par le répertoire depuis une position. */
export interface PositionMove {
  uci: string;
  san: string;
  toFen: string;
  toPosKey: string;
  /** Nœuds fusionnés de ce coup (plusieurs en cas de transposition). */
  nodeKeys: string[];
  selected: boolean;
  mainCount: number;
  nags: number[];
  comments: string[];
}

export interface PositionInfo {
  posKey: string;
  fen: string;
  turn: Color;
  /** Nœuds fusionnés qui atteignent cette position. */
  nodeKeys: string[];
  moves: PositionMove[];
  minPly: number;
}

export type PositionIndex = Map<string, PositionInfo>;

/**
 * Index des positions d'un répertoire. Une même position atteinte par
 * plusieurs ordres de coups regroupe tous les coups prévus : c'est ce qui
 * permet d'accepter un coup d'une autre ligne qui transpose.
 */
export function buildPositionIndex(forest: MergedForest, res?: ResolvedSelection): PositionIndex {
  const index: PositionIndex = new Map();
  for (const [posKey, nodes] of forest.byPos) {
    const info: PositionInfo = {
      posKey,
      fen: nodes[0].fen,
      turn: sideToMove(nodes[0].fen),
      nodeKeys: nodes.map((n) => n.key),
      moves: [],
      minPly: Math.min(...nodes.map((n) => n.ply)),
    };
    const byUci = new Map<string, PositionMove>();
    for (const n of nodes) {
      for (const c of n.children) {
        let m = byUci.get(c.uci);
        if (!m) {
          m = { uci: c.uci, san: c.san, toFen: c.fen, toPosKey: c.posKey, nodeKeys: [], selected: false, mainCount: 0, nags: [], comments: [] };
          byUci.set(c.uci, m);
          info.moves.push(m);
        }
        m.nodeKeys.push(c.key);
        m.mainCount += c.mainCount;
        if (res?.selected.has(c.key)) m.selected = true;
        for (const nag of c.nags) if (!m.nags.includes(nag)) m.nags.push(nag);
        for (const cm of c.comments) if (!m.comments.includes(cm.text)) m.comments.push(cm.text);
      }
    }
    info.moves.sort((a, b) => b.mainCount - a.mainCount);
    index.set(posKey, info);
  }
  return index;
}

/** Signature des réponses prévues : change si le répertoire modifie les coups de cette position. */
export function answersSignature(info: PositionInfo): string {
  return info.moves
    .map((m) => m.uci)
    .sort()
    .join(',');
}
