import { parseGame } from '@mliebelt/pgn-parser';
import type { ParseTree } from '@mliebelt/pgn-parser';
import { Chess } from 'chess.js';
import { START_FEN, normalizeFen, positionKey } from '../chess/fen';
import { moveNumberFromFenBefore } from '../chess/notation';
import { prepareForParser, quickHeaders, splitGames } from './split';
import type { GameRoot, HeaderList, MoveNode, ParsedFile, ParsedGame, PgnIssue, Shape, ShapeColor } from './types';
import { countTree } from './tree';

type PgnMove = ParseTree['moves'][number];
type CommentDiag = PgnMove['commentDiag'];

export interface ParseOptions {
  onProgress?: (done: number, total: number) => void;
}

const NAG_FROM_SYMBOL: Record<string, number> = { '!': 1, '?': 2, '!!': 3, '??': 4, '!?': 5, '?!': 6 };

function toNag(s: string): number | null {
  if (s.startsWith('$')) {
    const n = Number.parseInt(s.slice(1), 10);
    return Number.isFinite(n) ? n : null;
  }
  return NAG_FROM_SYMBOL[s] ?? null;
}

function headerValue(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return String(v);
  if (typeof v === 'object' && 'value' in (v as Record<string, unknown>)) {
    const val = (v as { value?: unknown }).value;
    return val == null ? '' : String(val);
  }
  return String(v);
}

/** Libellé lisible d'une partie, privilégiant le nom de chapitre Lichess. */
export function gameLabelFromHeaders(headers: HeaderList, index: number): string {
  const get = (k: string) => headers.find(([key]) => key === k)?.[1]?.trim() ?? '';
  const chapter = get('ChapterName');
  if (chapter && chapter !== '?') return chapter;
  const white = get('White');
  const black = get('Black');
  const event = get('Event');
  const players = [white, black].filter((p) => p && p !== '?').join(' – ');
  if (players && event && event !== '?') return `${event} : ${players}`;
  if (players) return players;
  if (event && event !== '?') return event;
  const opening = get('Opening');
  if (opening && opening !== '?') return opening;
  return `Partie ${index + 1}`;
}

function parseShapes(diag: CommentDiag | undefined | null): Shape[] {
  if (!diag) return [];
  const out: Shape[] = [];
  const valid = (c: string): c is ShapeColor => c === 'G' || c === 'R' || c === 'Y' || c === 'B';
  for (const a of diag.colorArrows ?? []) {
    const m = /^([GRYB])([a-h][1-8])([a-h][1-8])$/.exec(a.trim());
    if (m && valid(m[1])) out.push({ color: m[1], from: m[2], to: m[3] });
  }
  for (const f of diag.colorFields ?? []) {
    const m = /^([GRYB])([a-h][1-8])$/.exec(f.trim());
    if (m && valid(m[1])) out.push({ color: m[1], from: m[2] });
  }
  return out;
}

function parseCommands(diag: CommentDiag | undefined | null): Record<string, string> | undefined {
  if (!diag) return undefined;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(diag)) {
    if (k === 'comment' || k === 'colorArrows' || k === 'colorFields') continue;
    if (v == null) continue;
    out[k] = typeof v === 'string' ? v : JSON.stringify(v);
  }
  return Object.keys(out).length ? out : undefined;
}

function cleanComment(c: string | undefined | null): string | undefined {
  if (c == null) return undefined;
  const t = c.replace(/\s+/g, ' ').trim();
  return t || undefined;
}

/**
 * Re-sérialise des coups bruts de l'analyseur (pour conserver une suite illégale).
 * La numérotation est recalculée car l'analyseur ne la fournit pas toujours.
 */
export function rawMovesToText(moves: PgnMove[], moveNumber: number, color: 'w' | 'b', firstNeedsNumber = true): string {
  const parts: string[] = [];
  let needNumber = firstNeedsNumber;
  let n = moveNumber;
  let c = color;
  for (const m of moves) {
    if (m.commentMove) {
      parts.push(`{ ${m.commentMove.trim()} }`);
      needNumber = true;
    }
    const num = c === 'w' ? `${n}. ` : needNumber ? `${n}... ` : '';
    let token = `${num}${m.notation.notation === 'Z0' ? '--' : m.notation.notation}`;
    for (const nag of m.nag ?? []) token += ` ${nag}`;
    parts.push(token);
    needNumber = false;
    const comment = cleanComment(m.commentAfter);
    if (comment) {
      parts.push(`{ ${comment} }`);
      needNumber = true;
    }
    for (const v of m.variations ?? []) {
      parts.push(`(${rawMovesToText(v, n, c, true)})`);
      needNumber = true;
    }
    if (c === 'b') n++;
    c = c === 'w' ? 'b' : 'w';
  }
  return parts.join(' ');
}

interface BuildCtx {
  nextId: number;
  issues: PgnIssue[];
  gameIndex: number;
  gameLabel: string;
  duplicates: number;
}

function sameMove(a: MoveNode, uci: string) {
  return !a.invalid && a.uci === uci;
}

function mergeInto(target: MoveNode, source: MoveNode) {
  if (source.comments?.length) target.comments = [...(target.comments ?? []), ...source.comments];
  if (source.commentsBefore?.length) target.commentsBefore = [...(target.commentsBefore ?? []), ...source.commentsBefore];
  if (source.nags?.length) target.nags = [...new Set([...(target.nags ?? []), ...source.nags])];
  if (source.shapes?.length) target.shapes = [...(target.shapes ?? []), ...source.shapes];
  for (const child of source.children) {
    const existing = child.invalid ? undefined : target.children.find((c) => sameMove(c, child.uci));
    if (existing) mergeInto(existing, child);
    else target.children.push(child);
  }
}

type Container = { children: MoveNode[] };

function mergeChildren(target: Container, children: MoveNode[], ctx: BuildCtx) {
  for (const child of children) {
    const existing = child.invalid ? undefined : target.children.find((c) => sameMove(c, child.uci));
    if (existing) {
      ctx.duplicates++;
      mergeInto(existing, child);
    } else target.children.push(child);
  }
}

/**
 * Ajoute une variante (alternative au coup suivant de `target`). Si son premier
 * coup répète un coup existant, la fusion est différée à la fin de la ligne
 * courante pour que la suite principale reste en première position.
 */
function addVariation(fen: string, target: Container, moves: PgnMove[], ctx: BuildCtx, deferred: Array<() => void>) {
  const temp: Container = { children: [] };
  applyLine(fen, temp, moves, ctx);
  const first = temp.children[0];
  const dup = first && !first.invalid && target.children.some((c) => sameMove(c, first.uci));
  if (dup) deferred.push(() => mergeChildren(target, temp.children, ctx));
  else mergeChildren(target, temp.children, ctx);
}

function applyLine(parentFen: string, parent: Container, moves: PgnMove[], ctx: BuildCtx) {
  const deferred: Array<() => void> = [];
  try {
    applyLineInner(parentFen, parent, moves, ctx, deferred);
  } finally {
    for (const d of deferred) d();
  }
}

function applyLineInner(parentFen: string, parent: Container, moves: PgnMove[], ctx: BuildCtx, deferred: Array<() => void>) {
  let curFen = parentFen;
  let cur: Container = parent;
  const chess = new Chess(parentFen);
  for (let i = 0; i < moves.length; i++) {
    const m = moves[i];
    const fenBefore = curFen;
    const notation = m.notation?.notation ?? '';
    let node: MoveNode | null = null;
    let errorMsg: string | null = null;
    if (notation === 'Z0' || notation === '--') {
      errorMsg = 'Coup nul (« -- ») non pris en charge pour la révision';
    } else {
      try {
        const mv = chess.move(notation, { strict: false });
        node = {
          id: ctx.nextId++,
          san: mv.san,
          uci: mv.from + mv.to + (mv.promotion ?? ''),
          fen: mv.after,
          children: [],
        };
      } catch {
        errorMsg = `Coup illégal ou illisible : « ${notation} »`;
      }
    }
    const { moveNumber, color } = moveNumberFromFenBefore(fenBefore);
    const label = `${moveNumber}${color === 'w' ? '.' : '...'}${notation}`;
    if (!node) {
      const headText = rawMovesToText([{ ...m, variations: [] }], moveNumber, color, true);
      const nextColor = color === 'w' ? 'b' : 'w';
      const tailText = rawMovesToText(moves.slice(i + 1), color === 'b' ? moveNumber + 1 : moveNumber, nextColor, true);
      const invalidNode: MoveNode = {
        id: ctx.nextId++,
        san: notation,
        uci: '',
        fen: fenBefore,
        children: [],
        invalid: { head: headText, tail: tailText, error: errorMsg ?? 'Coup invalide' },
      };
      cur.children.push(invalidNode);
      ctx.issues.push({
        severity: 'error',
        message: `${errorMsg}. La suite de cette ligne est conservée telle quelle mais exclue des révisions.`,
        gameIndex: ctx.gameIndex,
        gameLabel: ctx.gameLabel,
        moveLabel: label,
      });
      // Les variantes de ce coup restent des alternatives depuis la même position.
      for (const v of m.variations ?? []) addVariation(fenBefore, cur, v, ctx, deferred);
      return;
    }
    const nags = (m.nag ?? []).map(toNag).filter((x): x is number => x != null);
    if (nags.length) node.nags = nags;
    const before = cleanComment(m.commentMove);
    if (before) node.commentsBefore = [before];
    const after = cleanComment(m.commentDiag?.comment ?? m.commentAfter);
    if (after) node.comments = [after];
    const shapes = parseShapes(m.commentDiag);
    if (shapes.length) node.shapes = shapes;
    const commands = parseCommands(m.commentDiag);
    if (commands) node.commands = commands;

    const existing = cur.children.find((c) => sameMove(c, node!.uci));
    if (existing) {
      ctx.duplicates++;
      mergeInto(existing, node);
      node = existing;
    } else {
      cur.children.push(node);
    }
    for (const v of m.variations ?? []) addVariation(fenBefore, cur, v, ctx, deferred);
    cur = node;
    curFen = node.fen;
  }
}

function lineColumnAt(text: string, offset: number): { line: number; column: number } {
  let line = 1;
  let last = -1;
  for (let i = 0; i < offset && i < text.length; i++) if (text[i] === '\n') {
    line++;
    last = i;
  }
  return { line, column: offset - last };
}

function lastMoveNumberBefore(text: string, offset: number): string | undefined {
  const before = text.slice(0, offset).replace(/\{[^}]*\}/g, ' ');
  const matches = [...before.matchAll(/(\d+)\s*(\.\.\.|\.)\s*([A-Za-z0-9+#=\-!?]+)?/g)];
  const last = matches[matches.length - 1];
  if (!last) return undefined;
  return `${last[1]}${last[2]}${last[3] ?? ''}`;
}

export function parseSingleGame(rawText: string, gameIndex: number, fileLineOffset = 0): ParsedGame {
  const issues: PgnIssue[] = [];
  const quick = quickHeaders(rawText);
  const fallbackLabel = gameLabelFromHeaders(quick, gameIndex);
  const prepared = prepareForParser(rawText);
  let tree: ParseTree;
  try {
    tree = parseGame(prepared, { startRule: 'game' });
  } catch (e) {
    const err = e as { message?: string; location?: { start?: { offset?: number } } };
    const offset = err.location?.start?.offset ?? 0;
    const lc = lineColumnAt(prepared, offset);
    issues.push({
      severity: 'error',
      message: `Erreur de syntaxe PGN : ${err.message ?? 'inconnue'}`,
      gameIndex,
      gameLabel: fallbackLabel,
      line: lc.line + fileLineOffset,
      column: lc.column,
      moveLabel: lastMoveNumberBefore(prepared, offset),
    });
    return {
      headers: quick,
      root: { fen: START_FEN, children: [] },
      rawPgn: rawText,
      fatal: true,
      issues,
      maxId: 0,
    };
  }

  const headers: HeaderList = [];
  for (const [k, v] of Object.entries(tree.tags ?? {})) {
    if (k === 'messages') continue;
    headers.push([k, headerValue(v)]);
  }
  // Conserve l'ordre exact du fichier quand c'est possible.
  if (quick.length === headers.length) {
    for (let i = 0; i < quick.length; i++) if (quick[i][0] === headers[i]?.[0]) headers[i] = quick[i];
  }
  const label = gameLabelFromHeaders(headers, gameIndex);
  const variant = headers.find(([k]) => k === 'Variant')?.[1]?.toLowerCase() ?? '';
  if (variant && !['standard', 'from position', 'normal', 'chess'].includes(variant)) {
    issues.push({
      severity: 'error',
      message: `Variante d'échecs « ${variant} » non prise en charge (seules les échecs classiques le sont).`,
      gameIndex,
      gameLabel: label,
    });
    return { headers, root: { fen: START_FEN, children: [] }, rawPgn: rawText, fatal: true, issues, maxId: 0 };
  }

  let startFen = START_FEN;
  const fenHeader = headers.find(([k]) => k === 'FEN')?.[1];
  if (fenHeader) {
    const r = normalizeFen(fenHeader);
    if ('error' in r) {
      issues.push({
        severity: 'error',
        message: `Position de départ (FEN) invalide : ${r.error}`,
        gameIndex,
        gameLabel: label,
      });
      return { headers, root: { fen: START_FEN, children: [] }, rawPgn: rawText, fatal: true, issues, maxId: 0 };
    }
    startFen = r.fen;
  }

  const root: GameRoot = { fen: startFen, children: [] };
  const gc = tree.gameComment;
  if (gc) {
    const c = cleanComment(gc.comment);
    if (c) root.comments = [c];
    const shapes = parseShapes(gc as CommentDiag);
    if (shapes.length) root.shapes = shapes;
    const commands = parseCommands(gc as CommentDiag);
    if (commands) root.commands = commands;
  }
  const ctx: BuildCtx = { nextId: 1, issues, gameIndex, gameLabel: label, duplicates: 0 };
  applyLine(startFen, root, tree.moves ?? [], ctx);
  if (ctx.duplicates > 0) {
    issues.push({
      severity: 'warning',
      message: `${ctx.duplicates} variante(s) répétant un coup déjà présent ont été regroupées avec lui (aucun coup ni commentaire perdu).`,
      gameIndex,
      gameLabel: label,
    });
  }
  for (const msg of tree.messages ?? []) {
    // Les en-têtes non standard (ChapterName, StudyName…) sont légitimes : pas d'alerte.
    if (/^Tag: .* not known/.test(msg.message)) continue;
    issues.push({ severity: 'warning', message: `Avertissement de l'analyseur : ${msg.message}`, gameIndex, gameLabel: label });
  }
  return { headers, root, rawPgn: rawText, fatal: false, issues, maxId: ctx.nextId - 1 };
}

/** Analyse un fichier PGN complet (une ou plusieurs parties). */
export function parsePgn(text: string, opts: ParseOptions = {}): ParsedFile {
  const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const chunks = splitGames(text);
  const games: ParsedGame[] = [];
  const issues: PgnIssue[] = [];
  chunks.forEach((chunk, idx) => {
    const g = parseSingleGame(chunk.text, games.length, chunk.line - 1);
    const hasContent = g.headers.length > 0 || g.root.children.length > 0 || g.fatal;
    if (!hasContent) {
      issues.push({
        severity: 'warning',
        message: 'Texte sans en-tête ni coup ignoré (commentaire isolé hors partie).',
        gameIndex: idx,
        gameLabel: '—',
        line: chunk.line,
      });
    } else {
      games.push(g);
      issues.push(...g.issues);
    }
    opts.onProgress?.(idx + 1, chunks.length);
  });
  if (!chunks.length) {
    issues.push({ severity: 'error', message: 'Le fichier est vide ou ne contient aucune partie PGN.', gameIndex: -1, gameLabel: '—' });
  }
  let positions = new Set<string>();
  let moves = 0;
  let lines = 0;
  let variations = 0;
  let comments = 0;
  let shapes = 0;
  let invalidMoves = 0;
  for (const g of games) {
    const c = countTree(g.root);
    moves += c.moves;
    lines += c.lines;
    variations += c.variations;
    comments += c.comments;
    shapes += c.shapes;
    invalidMoves += c.invalid;
    positions.add(positionKey(g.root.fen));
    for (const k of c.positionKeys) positions.add(k);
  }
  const report = {
    games: games.length,
    validGames: games.filter((g) => !g.fatal).length,
    positions: positions.size,
    moves,
    lines,
    variations,
    comments,
    shapes,
    invalidMoves,
    issues,
    durationMs: Math.round((typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0),
  };
  positions = new Set();
  return { games, report };
}
