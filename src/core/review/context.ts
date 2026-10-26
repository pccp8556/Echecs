import type { Color } from '../chess/fen';
import { buildForest, leafCounts, type MergedForest } from '../repertoire/merged';
import { enumerateLines, type Line } from '../repertoire/lines';
import { buildPositionIndex, type PositionIndex } from '../repertoire/positions';
import { resolveSelection, type RepertoireSelection, type ResolvedSelection } from '../repertoire/selection';
import { repertoireColor, type GameRecord, type Repertoire } from '../repertoire/types';
import { gameLabelFromHeaders } from '../pgn/parse';

/** Données dérivées d'un répertoire pour une session (non persistées). */
export interface RepContext {
  repertoire: Repertoire;
  games: GameRecord[];
  forest: MergedForest;
  resolved: ResolvedSelection;
  index: PositionIndex;
  lines: Line[];
  linesByKey: Map<string, Line>;
  /** Lignes passant par une position (avec l'index de l'étape jouée depuis cette position). */
  linesByPos: Map<string, Array<{ line: Line; step: number }>>;
  leaves: Map<string, number>;
  gameLabel: (gameId: string) => string;
  gameColor: (gameId: string) => Color;
}

export interface SessionContext {
  reps: Map<string, RepContext>;
}

export function buildRepContext(repertoire: Repertoire, games: GameRecord[], selection: RepertoireSelection): RepContext {
  const forest = buildForest(games);
  const resolved = resolveSelection(forest, selection, repertoire.marks);
  const index = buildPositionIndex(forest, resolved);
  const lines = enumerateLines(forest, resolved, repertoire.id);
  const linesByKey = new Map(lines.map((l) => [l.key, l]));
  const linesByPos = new Map<string, Array<{ line: Line; step: number }>>();
  for (const line of lines) {
    line.steps.forEach((s, i) => {
      const list = linesByPos.get(s.posKeyBefore);
      if (list) list.push({ line, step: i });
      else linesByPos.set(s.posKeyBefore, [{ line, step: i }]);
    });
  }
  const labels = new Map(games.map((g, i) => [g.id, gameLabelFromHeaders(g.headers, i)]));
  const colors = new Map(games.map((g) => [g.id, g.color ?? repertoireColor(repertoire)]));
  return {
    repertoire,
    games,
    forest,
    resolved,
    index,
    lines,
    linesByKey,
    linesByPos,
    leaves: leafCounts(forest),
    gameLabel: (id) => labels.get(id) ?? 'Partie',
    gameColor: (id) => colors.get(id) ?? repertoireColor(repertoire),
  };
}

export function buildSessionContext(
  data: Array<{ repertoire: Repertoire; games: GameRecord[] }>,
  selections: RepertoireSelection[],
): SessionContext {
  const reps = new Map<string, RepContext>();
  for (const sel of selections) {
    const d = data.find((x) => x.repertoire.id === sel.repertoireId);
    if (!d) continue;
    reps.set(sel.repertoireId, buildRepContext(d.repertoire, d.games, sel));
  }
  return { reps };
}

/** Camp joué par l'utilisateur pour une ligne. */
export function userColorForLine(ctx: RepContext, line: Line, sessionColor: Color | 'auto' | 'both'): Color | 'both' {
  if (sessionColor !== 'auto') return sessionColor;
  const gid = line.gameIds[0];
  return gid ? ctx.gameColor(gid) : repertoireColor(ctx.repertoire);
}

export function userColorForRepertoire(ctx: RepContext, sessionColor: Color | 'auto' | 'both'): Color | 'both' {
  if (sessionColor !== 'auto') return sessionColor;
  return repertoireColor(ctx.repertoire);
}
