import { positionKey } from '../chess/fen';
import { exportGame, joinGames } from '../pgn/export';
import type { GameRoot, MoveNode } from '../pgn/types';
import { childKey, rootKeyOf, rootNodeKey } from './merged';
import { LINE_MARKS, type GameRecord, type LineMark, type Repertoire } from './types';
import { orderedGames } from './build';

export interface RepertoireExportOptions {
  /** Ajoute les marques et notes personnelles en commentaires PGN. */
  annotations: boolean;
  /** Notes personnelles par position. */
  notes?: Map<string, string>;
  /** Clés fusionnées à conserver (export d'une sélection) ; toutes si absent. */
  keep?: Set<string>;
}

export const MARK_COMMAND = 'patmark';
export const NOTE_PREFIX = 'Note perso :';

/** Construit la table nœud → clé fusionnée d'une partie. */
export function nodeKeys(game: GameRecord): Map<number, string> {
  const out = new Map<number, string>();
  const root = rootNodeKey(rootKeyOf(game.root.fen));
  const stack: Array<[MoveNode, string]> = game.root.children.map((c) => [c, root]);
  while (stack.length) {
    const [n, parentKey] = stack.pop()!;
    if (n.invalid) continue;
    const key = childKey(parentKey, n.uci);
    out.set(n.id, key);
    for (const c of n.children) stack.push([c, key]);
  }
  return out;
}

function pruneRoot(root: GameRoot, keys: Map<number, string>, keep: Set<string>): GameRoot {
  const prune = (children: MoveNode[]): MoveNode[] =>
    children
      .filter((c) => c.invalid || keep.has(keys.get(c.id) ?? ''))
      .map((c) => ({ ...c, children: prune(c.children) }));
  return { ...root, children: prune(root.children) };
}

export function exportGameRecord(game: GameRecord, rep: Repertoire, opts: RepertoireExportOptions): string {
  const keys = nodeKeys(game);
  const markFor = (n: MoveNode): LineMark | undefined => rep.marks[keys.get(n.id) ?? ''];
  const hasAnnotations = opts.annotations && (Object.keys(rep.marks).length > 0 || (opts.notes?.size ?? 0) > 0);
  // Texte d'origine conservé tel quel si rien n'a changé.
  if (!game.modified && !opts.keep && !hasAnnotations && game.rawPgn.trim()) return game.rawPgn.trim() + '\n';
  if (game.fatal) return game.rawPgn.trim() + '\n';
  const notesUsed = new Set<string>();
  const root = opts.keep ? pruneRoot(game.root, keys, opts.keep) : game.root;
  return exportGame(game.headers, root, {
    extraComments: opts.annotations
      ? (n) => {
          const out: string[] = [];
          const mark = markFor(n);
          if (mark) out.push(`[%${MARK_COMMAND} ${mark}] Ligne ${LINE_MARKS[mark].label.toLowerCase()}`);
          const pk = positionKey(n.fen);
          const note = opts.notes?.get(pk);
          if (note && !notesUsed.has(pk)) {
            notesUsed.add(pk);
            out.push(`${NOTE_PREFIX} ${note}`);
          }
          return out;
        }
      : undefined,
  });
}

export function exportRepertoirePgn(rep: Repertoire, games: GameRecord[], opts: RepertoireExportOptions): string {
  return joinGames(orderedGames(rep, games).map((g) => exportGameRecord(g, rep, opts)));
}

/** Nom de fichier sûr pour un export. */
export function safeFileName(name: string, ext = 'pgn'): string {
  const base = name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9-_ ]+/g, '')
    .trim()
    .replace(/\s+/g, '_')
    .slice(0, 80);
  return `${base || 'repertoire'}.${ext}`;
}

/** Récupère les marques personnelles présentes dans un PGN réimporté. */
export function marksFromGames(games: GameRecord[]): Record<string, LineMark> {
  const marks: Record<string, LineMark> = {};
  for (const g of games) {
    const keys = nodeKeys(g);
    const stack = [...g.root.children];
    while (stack.length) {
      const n = stack.pop()!;
      const m = n.commands?.[MARK_COMMAND] as LineMark | undefined;
      if (m && m in LINE_MARKS) marks[keys.get(n.id) ?? ''] = m;
      stack.push(...n.children);
    }
  }
  delete marks[''];
  return marks;
}
