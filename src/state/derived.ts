import { useEffect, useMemo, useState } from 'react';
import { buildForest, commonTrunk, type MergedForest, type MergedNode } from '../core/repertoire/merged';
import { buildPositionIndex, type PositionIndex } from '../core/repertoire/positions';
import { repertoireColor, type GameRecord, type Repertoire } from '../core/repertoire/types';
import { cardId, isDue, masteryOf, MASTERY_SCORE, type MasteryLevel, type ReviewCard } from '../core/srs/srs';
import type { Line } from '../core/repertoire/lines';
import { sideToMove, type Color } from '../core/chess/fen';
import { useLibrary } from './library';

interface Derived {
  forest: MergedForest;
  index: PositionIndex;
  trunk: MergedNode | null;
}

const cache = new Map<string, { stamp: string; value: Derived }>();

export function derive(rep: Repertoire, games: GameRecord[]): Derived {
  const stamp = `${rep.updatedAt}|${games.length}|${games.reduce((s, g) => s + g.updatedAt, 0)}`;
  const hit = cache.get(rep.id);
  if (hit && hit.stamp === stamp) return hit.value;
  const forest = buildForest(games);
  const value = { forest, index: buildPositionIndex(forest), trunk: commonTrunk(forest) };
  cache.set(rep.id, { stamp, value });
  return value;
}

/** Positions où l'utilisateur doit jouer (camp du répertoire ou de la partie). */
export function userPositionKeys(rep: Repertoire, games: GameRecord[], forest: MergedForest): Set<string> {
  const colors = new Map(games.map((g) => [g.id, g.color ?? repertoireColor(rep)]));
  const out = new Set<string>();
  for (const n of forest.byKey.values()) {
    if (!n.children.length) continue;
    const turn = sideToMove(n.fen);
    const gid = n.occurrences[0]?.gameId;
    const color = (gid && colors.get(gid)) || repertoireColor(rep);
    if (turn === color) out.add(n.posKey);
  }
  return out;
}

export interface MasterySummary {
  counts: Record<MasteryLevel, number>;
  total: number;
  due: number;
  score: number;
  lastReviewedAt?: number;
}

export function masterySummary(repId: string, positions: Iterable<string>, cards: Map<string, ReviewCard>, now: number): MasterySummary {
  const counts: Record<MasteryLevel, number> = { new: 0, learning: 0, fragile: 0, solid: 0, mastered: 0 };
  let total = 0;
  let due = 0;
  let score = 0;
  let last = 0;
  for (const pk of positions) {
    const c = cards.get(cardId(repId, pk));
    const level = masteryOf(c, now);
    counts[level]++;
    total++;
    score += MASTERY_SCORE[level];
    if (c && isDue(c, now)) due++;
    if (c?.lastReviewedAt && c.lastReviewedAt > last) last = c.lastReviewedAt;
  }
  return { counts, total, due, score: total ? score / total : 0, lastReviewedAt: last || undefined };
}

export function lineMastery(line: Line, color: Color | 'both', cards: Map<string, ReviewCard>, now: number): { level: MasteryLevel; score: number; positions: number } {
  const order: MasteryLevel[] = ['fragile', 'new', 'learning', 'solid', 'mastered'];
  let worst: MasteryLevel = 'mastered';
  let score = 0;
  let n = 0;
  for (const s of line.steps) {
    if (color !== 'both' && s.turn !== color) continue;
    const level = masteryOf(cards.get(cardId(line.repertoireId, s.posKeyBefore)), now);
    if (order.indexOf(level) < order.indexOf(worst)) worst = level;
    score += MASTERY_SCORE[level];
    n++;
  }
  return { level: n ? worst : 'new', score: n ? score / n : 0, positions: n };
}

/** Charge les parties d'un répertoire et calcule les données dérivées. */
export function useRepertoire(id: string | undefined) {
  const rep = useLibrary((s) => s.repertoires.find((r) => r.id === id));
  const loaded = useLibrary((s) => s.loaded);
  const gamesMap = useLibrary((s) => s.games);
  const loadGames = useLibrary((s) => s.loadGames);
  const [error, setError] = useState<string>();
  const games = id ? gamesMap[id] : undefined;
  useEffect(() => {
    if (id && rep && !games) loadGames(id).catch((e) => setError(String(e)));
  }, [id, rep, games, loadGames]);
  const derived = useMemo(() => (rep && games ? derive(rep, games) : undefined), [rep, games]);
  return { rep, games, derived, loading: !loaded || (!!rep && !games), notFound: loaded && !rep, error };
}
