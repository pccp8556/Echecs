import { countTree } from '../pgn/tree';
import { gameLabelFromHeaders } from '../pgn/parse';
import { positionKey } from '../chess/fen';
import type { ParsedFile, ParsedGame } from '../pgn/types';
import { buildForest, detectColor } from './merged';
import type { GameRecord, Repertoire, RepertoireStats, SourceInfo } from './types';

export function newId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return 'id-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

/** Empreinte rapide (FNV-1a 53 bits) pour détecter une modification de contenu. */
export function hashText(text: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 16777619);
    h2 = Math.imul(h2 ^ c, 2246822519);
  }
  return ((h2 >>> 0).toString(16).padStart(8, '0') + (h1 >>> 0).toString(16).padStart(8, '0')).slice(0, 16);
}

export function gameRecordFromParsed(g: ParsedGame, repertoireId: string, now = Date.now()): GameRecord {
  return {
    id: newId(),
    repertoireId,
    headers: g.headers,
    root: g.root,
    rawPgn: g.rawPgn,
    modified: false,
    fatal: g.fatal,
    issues: g.issues,
    maxId: g.maxId,
    updatedAt: now,
  };
}

export function computeStats(games: GameRecord[]): RepertoireStats {
  const positions = new Set<string>();
  const s: RepertoireStats = { games: games.length, validGames: 0, moves: 0, positions: 0, lines: 0, variations: 0, comments: 0, errors: 0, warnings: 0, invalidMoves: 0 };
  for (const g of games) {
    s.errors += g.issues.filter((i) => i.severity === 'error').length;
    s.warnings += g.issues.filter((i) => i.severity === 'warning').length;
    if (g.fatal) continue;
    s.validGames++;
    const c = countTree(g.root);
    s.moves += c.moves;
    s.variations += c.variations;
    s.comments += c.comments;
    s.invalidMoves += c.invalid;
    positions.add(positionKey(g.root.fen));
    for (const k of c.positionKeys) positions.add(k);
  }
  s.positions = positions.size;
  // Lignes distinctes une fois les chapitres fusionnés.
  const forest = buildForest(games);
  for (const n of forest.byKey.values()) if (n.parentKey !== null && n.children.length === 0) s.lines++;
  return s;
}

export function defaultNameFromFile(fileName: string | undefined, parsed: ParsedFile): string {
  const fromFile = fileName?.replace(/\.pgn$/i, '').replace(/[_-]+/g, ' ').trim();
  const study = parsed.games[0]?.headers.find(([k]) => k === 'StudyName')?.[1];
  const event = parsed.games[0]?.headers.find(([k]) => k === 'Event')?.[1];
  if (study && event && event !== '?') return `${event} — ${study}`;
  if (fromFile) return fromFile.charAt(0).toUpperCase() + fromFile.slice(1);
  if (event && event !== '?') return event;
  return 'Nouveau répertoire';
}

export function repertoireFromParsed(parsed: ParsedFile, opts: { name: string; source: SourceInfo; now?: number }): { repertoire: Repertoire; games: GameRecord[] } {
  const now = opts.now ?? Date.now();
  const id = newId();
  const games = parsed.games.map((g) => gameRecordFromParsed(g, id, now));
  const forest = buildForest(games);
  const repertoire: Repertoire = {
    id,
    name: opts.name,
    folderId: null,
    tags: [],
    favorite: false,
    color: 'auto',
    detectedColor: detectColor(games, forest),
    source: opts.source,
    createdAt: now,
    updatedAt: now,
    stats: computeStats(games),
    marks: {},
    modified: false,
    gameOrder: games.map((g) => g.id),
  };
  return { repertoire, games };
}

export function gameLabel(g: GameRecord, index: number): string {
  return gameLabelFromHeaders(g.headers, index);
}

export function orderedGames(rep: Repertoire, games: GameRecord[]): GameRecord[] {
  const pos = new Map(rep.gameOrder.map((id, i) => [id, i]));
  return [...games].sort((a, b) => (pos.get(a.id) ?? 1e9) - (pos.get(b.id) ?? 1e9));
}
