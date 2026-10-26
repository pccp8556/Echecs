import type { Color } from '../core/chess/fen';
import { parsePgn } from '../core/pgn/parse';
import type { ParsedFile } from '../core/pgn/types';
import { gameRecordFromParsed, hashText, repertoireFromParsed } from '../core/repertoire/build';
import { buildForest, detectColor } from '../core/repertoire/merged';
import type { GameRecord, Repertoire, SourceInfo } from '../core/repertoire/types';
import { DEMO_NAME, DEMO_PGN } from '../demo/demo';
import { useLibrary } from '../state/library';
import { toast } from '../ui/kit';

export async function importParsed(parsed: ParsedFile, opts: { name: string; source: SourceInfo; color?: Color | 'auto'; folderId?: string | null; tags?: string[] }): Promise<Repertoire> {
  const { repertoire, games } = repertoireFromParsed(parsed, { name: opts.name, source: opts.source });
  const rep: Repertoire = { ...repertoire, color: opts.color ?? 'auto', folderId: opts.folderId ?? null, tags: opts.tags ?? [] };
  await useLibrary.getState().addRepertoire(rep, games);
  return rep;
}

export async function importDemo(): Promise<Repertoire | undefined> {
  try {
    const parsed = parsePgn(DEMO_PGN);
    const rep = await importParsed(parsed, {
      name: DEMO_NAME,
      source: { kind: 'demo', importedAt: Date.now(), contentHash: hashText(DEMO_PGN), fileName: 'demonstration.pgn' },
      tags: ['démo'],
    });
    toast.success('Répertoire de démonstration ajouté', 'Il est identifié « Démonstration » : supprime-le quand tu auras importé tes PGN.');
    return rep;
  } catch (e) {
    toast.error('Import impossible', e instanceof Error ? e.message : String(e));
  }
}

function gameSignature(headers: Array<[string, string]>, index: number): string {
  const get = (k: string) => headers.find(([key]) => key === k)?.[1] ?? '';
  const url = get('ChapterURL');
  if (url) return `url:${url}`;
  return ['Event', 'Site', 'Round', 'White', 'Black', 'ChapterName'].map(get).join('|') + `|#${index}`;
}

/**
 * Remplace le contenu d'un répertoire par une nouvelle version (rechargement
 * depuis la source). Les parties correspondantes gardent leur identifiant et
 * leurs réglages ; une révision de l'ancienne version est conservée.
 */
export async function replaceFromSource(rep: Repertoire, parsed: ParsedFile, source: SourceInfo): Promise<Repertoire> {
  const lib = useLibrary.getState();
  const old = await lib.loadGames(rep.id, true);
  const bySig = new Map(old.map((g, i) => [gameSignature(g.headers, i), g]));
  const now = Date.now();
  const games: GameRecord[] = parsed.games.map((pg, i) => {
    const fresh = gameRecordFromParsed(pg, rep.id, now);
    const prev = bySig.get(gameSignature(pg.headers, i));
    return prev ? { ...fresh, id: prev.id, color: prev.color } : fresh;
  });
  const forest = buildForest(games);
  return lib.saveContent({ ...rep, source, modified: false, detectedColor: detectColor(games, forest), gameOrder: games.map((g) => g.id) }, games, 'Avant rechargement depuis la source');
}
