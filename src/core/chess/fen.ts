import { Chess, DEFAULT_POSITION, validateFen } from 'chess.js';

export type Color = 'w' | 'b';

export const START_FEN = DEFAULT_POSITION;

/**
 * Identifiant normalisé d'une position : placement, trait, roques et case de
 * prise en passant (seulement si une prise en passant est réellement jouable,
 * comme le fait chess.js). Les compteurs de coups sont ignorés afin que deux
 * ordres de coups menant à la même position (transpositions) se rejoignent.
 */
export function positionKey(fen: string): string {
  return fen.split(' ').slice(0, 4).join(' ');
}

export const START_KEY = positionKey(START_FEN);

export function sideToMove(fen: string): Color {
  return fen.split(' ')[1] === 'b' ? 'b' : 'w';
}

/** Numéro du coup (fullmove) indiqué dans la FEN. */
export function fullMoveNumber(fen: string): number {
  const n = Number.parseInt(fen.split(' ')[5] ?? '1', 10);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

/** Valide et normalise une FEN (en passant canonique). Retourne null si invalide. */
export function normalizeFen(fen: string): { fen: string } | { error: string } {
  const trimmed = fen.trim().replace(/\s+/g, ' ');
  // Certaines FEN omettent les compteurs : on les complète.
  const parts = trimmed.split(' ');
  while (parts.length < 6) parts.push(parts.length === 4 ? '0' : parts.length === 5 ? '1' : '-');
  const candidate = parts.slice(0, 6).join(' ');
  const v = validateFen(candidate);
  if (!v.ok) return { error: v.error ?? 'FEN invalide' };
  try {
    const c = new Chess(candidate);
    return { fen: c.fen() };
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'FEN invalide' };
  }
}

export function isStartPosition(fen: string): boolean {
  return positionKey(fen) === START_KEY;
}

export function opposite(c: Color): Color {
  return c === 'w' ? 'b' : 'w';
}

export function colorName(c: Color): string {
  return c === 'w' ? 'Blancs' : 'Noirs';
}
