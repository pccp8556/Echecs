import { moveNumberFromFenBefore } from '../chess/notation';
import type { GameRoot, HeaderList, MoveNode, Shape } from './types';
import type { TreeNode } from './tree';

export interface ExportOptions {
  /** Largeur maximale des lignes (80 recommandé par le standard PGN). */
  maxWidth?: number;
  /** Commentaires supplémentaires (annotations personnelles) à ajouter après un coup. */
  extraComments?: (node: MoveNode) => string[] | undefined;
}

const SYMBOL_NAGS: Record<number, string> = { 1: '!', 2: '?', 3: '!!', 4: '??', 5: '!?', 6: '?!' };

function escapeHeader(v: string): string {
  return v.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function escapeComment(c: string): string {
  // Une accolade fermante terminerait le commentaire : on la remplace.
  return c.replace(/}/g, ')').replace(/{/g, '(');
}

export function shapesToCommand(shapes: Shape[] | undefined): string {
  if (!shapes?.length) return '';
  const circles = shapes.filter((s) => !s.to).map((s) => `${s.color}${s.from}`);
  const arrows = shapes.filter((s) => s.to).map((s) => `${s.color}${s.from}${s.to}`);
  let out = '';
  if (circles.length) out += `[%csl ${circles.join(',')}]`;
  if (arrows.length) out += `[%cal ${arrows.join(',')}]`;
  return out;
}

function commandsToText(commands: Record<string, string> | undefined): string {
  if (!commands) return '';
  return Object.entries(commands)
    .map(([k, v]) => `[%${k} ${v}]`)
    .join('');
}

function commentTokens(comments: string[] | undefined, shapes?: Shape[], commands?: Record<string, string>): string[] {
  const out: string[] = [];
  for (const c of comments ?? []) if (c.trim()) out.push(`{ ${escapeComment(c.trim())} }`);
  const cmd = shapesToCommand(shapes) + commandsToText(commands);
  if (cmd) out.push(`{ ${cmd} }`);
  return out;
}

function moveToken(node: MoveNode, fenBefore: string, forceNumber: boolean): string {
  const { moveNumber, color } = moveNumberFromFenBefore(fenBefore);
  const num = color === 'w' ? `${moveNumber}. ` : forceNumber ? `${moveNumber}... ` : '';
  const nags = node.nags ?? [];
  const sym = nags.filter((n) => SYMBOL_NAGS[n]).map((n) => SYMBOL_NAGS[n]).slice(0, 1).join('');
  const others = nags.filter((n, i) => !SYMBOL_NAGS[n] || nags.findIndex((x) => SYMBOL_NAGS[x]) !== i).map((n) => `$${n}`);
  return [num + node.san + sym, ...others].join(' ');
}

function writeMove(node: MoveNode, fenBefore: string, force: boolean, out: string[], opts: ExportOptions): boolean {
  if (node.invalid) {
    out.push(node.invalid.head);
    return true;
  }
  for (const t of commentTokens(node.commentsBefore)) out.push(t);
  const forceNum = force || (node.commentsBefore?.length ?? 0) > 0;
  out.push(moveToken(node, fenBefore, forceNum));
  const extra = opts.extraComments?.(node) ?? [];
  const tokens = commentTokens([...(node.comments ?? []), ...extra], node.shapes, node.commands);
  out.push(...tokens);
  return tokens.length > 0;
}

function writeLine(parent: TreeNode, force: boolean, out: string[], opts: ExportOptions) {
  let node: TreeNode = parent;
  let needNumber = force;
  // Itératif sur la ligne principale, récursif sur les variantes.
  for (;;) {
    if (!node.children.length) return;
    const [main, ...vars] = node.children;
    needNumber = writeMove(main, node.fen, needNumber, out, opts);
    for (const v of vars) {
      out.push(OPEN);
      const afterComment = writeMove(v, node.fen, true, out, opts);
      if (v.invalid) {
        if (v.invalid.tail) out.push(v.invalid.tail);
      } else writeLine(v, afterComment, out, opts);
      out.push(CLOSE);
      needNumber = true;
    }
    if (main.invalid) {
      if (main.invalid.tail) out.push(main.invalid.tail);
      return;
    }
    node = main;
  }
}

const OPEN = '\u0001(';
const CLOSE = '\u0001)';

function wrap(tokens: string[], width: number): string {
  const words: string[] = [];
  for (const t of tokens) {
    if (t === OPEN || t === CLOSE) {
      words.push(t);
      continue;
    }
    // Seuls les commentaires sont coupés ; « 7. e5! » reste sur une seule ligne.
    words.push(...(t.startsWith('{') ? t.split(/\s+/).filter(Boolean) : [t]));
  }
  const lines: string[] = [];
  let cur = '';
  for (let i = 0; i < words.length; i++) {
    const raw = words[i];
    const w = raw === OPEN ? '(' : raw === CLOSE ? ')' : raw;
    const prev = words[i - 1];
    // Pas d'espace après « ( » ni avant « ) ».
    const glue = cur === '' || prev === OPEN || raw === CLOSE ? '' : ' ';
    if (cur && cur.length + glue.length + w.length > width && raw !== CLOSE && prev !== OPEN) {
      lines.push(cur);
      cur = w;
    } else cur += glue + w;
  }
  if (cur) lines.push(cur);
  return lines.join('\n');
}

export function exportMovetext(root: GameRoot, result: string, opts: ExportOptions = {}): string {
  const out: string[] = [];
  out.push(...commentTokens(root.comments, root.shapes, root.commands));
  writeLine(root, true, out, opts);
  out.push(result || '*');
  return wrap(out, opts.maxWidth ?? 80);
}

export function exportGame(headers: HeaderList, root: GameRoot, opts: ExportOptions = {}): string {
  const result = headers.find(([k]) => k === 'Result')?.[1] || '*';
  const hasResult = headers.some(([k]) => k === 'Result');
  const hs = hasResult ? headers : [...headers, ['Result', '*'] as [string, string]];
  const headerText = hs.map(([k, v]) => `[${k} "${escapeHeader(v)}"]`).join('\n');
  return `${headerText}\n\n${exportMovetext(root, result, opts)}\n`;
}

export function joinGames(texts: string[]): string {
  return texts.map((t) => t.trim()).join('\n\n\n') + '\n';
}
