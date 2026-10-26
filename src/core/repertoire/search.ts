import { sanCandidatesFromInput } from '../chess/notation';
import type { MergedForest } from './merged';

/** Nœuds atteints par une séquence de coups (SAN fr/en, numéros ignorés) depuis une position de départ. */
export function sequenceNodes(forest: MergedForest, query: string, style: 'fr' | 'en' | 'figurine'): MergedForest['roots'] {
  const tokens = query
    .replace(/\d+\.(\.\.)?/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
  if (!tokens.length) return [];
  let frontier = forest.roots;
  for (const t of tokens) {
    const cands = sanCandidatesFromInput(t, style).map((c) => c.replace(/[+#]/g, ''));
    frontier = frontier.flatMap((n) => n.children.filter((c) => cands.includes(c.san.replace(/[+#]/g, ''))));
    if (!frontier.length) return [];
  }
  return frontier;
}

export function matchMoves(forest: MergedForest, query: string, style: 'fr' | 'en' | 'figurine'): boolean {
  return sequenceNodes(forest, query, style).length > 0;
}

