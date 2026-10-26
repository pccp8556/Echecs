import type { Color } from './fen';

export type NotationStyle = 'fr' | 'en' | 'figurine';

const EN_TO_FR: Record<string, string> = { K: 'R', Q: 'D', R: 'T', B: 'F', N: 'C' };
const FR_TO_EN: Record<string, string> = { R: 'K', D: 'Q', T: 'R', F: 'B', C: 'N' };
const FIGURINES: Record<string, string> = { K: '♔', Q: '♕', R: '♖', B: '♗', N: '♘' };

/** Convertit un SAN anglais (format PGN) vers le style d'affichage choisi. */
export function formatSan(san: string, style: NotationStyle): string {
  if (style === 'en' || !san) return san;
  if (san.startsWith('O-O')) return san;
  const map = style === 'fr' ? EN_TO_FR : FIGURINES;
  let out = san.replace(/^[KQRBN]/, (p) => map[p] ?? p);
  out = out.replace(/=([QRBN])/, (_, p: string) => '=' + (map[p] ?? p));
  return out;
}

/**
 * Convertit une saisie utilisateur (française ou anglaise) en SAN anglais.
 * Renvoie plusieurs candidats car « R » est ambigu (Roi en français, Tour en anglais).
 */
export function sanCandidatesFromInput(input: string, preferred: NotationStyle): string[] {
  const raw = input.trim().replace(/0-0-0/g, 'O-O-O').replace(/0-0/g, 'O-O').replace(/[!?]+$/, '');
  if (!raw) return [];
  const fr = raw.replace(/^[RDTFC]/, (p) => FR_TO_EN[p] ?? p).replace(/=([RDTFC])/, (_, p: string) => '=' + (FR_TO_EN[p] ?? p));
  const figurine = raw.replace(/[♔♚]/g, 'K').replace(/[♕♛]/g, 'Q').replace(/[♖♜]/g, 'R').replace(/[♗♝]/g, 'B').replace(/[♘♞]/g, 'N');
  const ordered = preferred === 'fr' ? [fr, raw, figurine] : [raw, fr, figurine];
  return [...new Set(ordered)];
}

/** Libellé de coup numéroté : « 7.Fg5 » ou « 7...Cc6 ». */
export function moveLabel(moveNumber: number, color: Color, san: string, style: NotationStyle, forceNumber = true): string {
  const s = formatSan(san, style);
  if (color === 'w') return `${moveNumber}.${s}`;
  return forceNumber ? `${moveNumber}...${s}` : s;
}

/** Numéro de coup et couleur du coup joué depuis une position (FEN avant le coup). */
export function moveNumberFromFenBefore(fenBefore: string): { moveNumber: number; color: Color } {
  const parts = fenBefore.split(' ');
  const color: Color = parts[1] === 'b' ? 'b' : 'w';
  const n = Number.parseInt(parts[5] ?? '1', 10);
  return { moveNumber: Number.isFinite(n) && n > 0 ? n : 1, color };
}

/** Formate une séquence de coups SAN en notation numérotée. */
export function formatLine(sans: string[], startFen: string, style: NotationStyle): string {
  const { moveNumber, color } = moveNumberFromFenBefore(startFen);
  let n = moveNumber;
  let c: Color = color;
  const parts: string[] = [];
  sans.forEach((san, i) => {
    if (c === 'w') parts.push(`${n}.${formatSan(san, style)}`);
    else parts.push(i === 0 ? `${n}...${formatSan(san, style)}` : formatSan(san, style));
    if (c === 'b') n += 1;
    c = c === 'w' ? 'b' : 'w';
  });
  return parts.join(' ');
}

export const NAG_SYMBOLS: Record<number, string> = {
  1: '!', 2: '?', 3: '!!', 4: '??', 5: '!?', 6: '?!', 7: '□', 10: '=', 13: '∞', 14: '⩲', 15: '⩱', 16: '±', 17: '∓', 18: '+−', 19: '−+',
  22: '⨀', 23: '⨀', 32: '⟳', 33: '⟳', 36: '→', 37: '→', 40: '↑', 41: '↑', 44: '=∞', 45: '=∞', 132: '⇆', 133: '⇆', 138: '⊕', 139: '⊕', 140: '∆', 146: 'N',
};

export const NAG_LABELS: Record<number, string> = {
  1: 'Bon coup', 2: 'Mauvais coup', 3: 'Coup brillant', 4: 'Gaffe', 5: 'Coup intéressant', 6: 'Coup douteux', 7: 'Coup unique',
  10: 'Position égale', 13: 'Position peu claire', 14: 'Léger avantage blanc', 15: 'Léger avantage noir', 16: 'Net avantage blanc',
  17: 'Net avantage noir', 18: 'Avantage décisif blanc', 19: 'Avantage décisif noir', 22: 'Zugzwang', 23: 'Zugzwang',
  32: 'Avance de développement', 33: 'Avance de développement', 36: 'Initiative', 37: 'Initiative', 40: 'Attaque', 41: 'Attaque',
  44: 'Compensation', 45: 'Compensation', 132: 'Contre-jeu', 133: 'Contre-jeu', 138: 'Zeitnot', 139: 'Zeitnot', 140: 'Avec l’idée', 146: 'Nouveauté',
};

/** NAG de qualité de coup (1–7) affichés collés au coup ; les autres sont des évaluations de position. */
export function isMoveNag(nag: number): boolean {
  return nag >= 1 && nag <= 7;
}

export function nagText(nags: number[] | undefined): string {
  if (!nags?.length) return '';
  const move = nags.filter(isMoveNag).map((n) => NAG_SYMBOLS[n] ?? '').join('');
  const pos = nags.filter((n) => !isMoveNag(n)).map((n) => NAG_SYMBOLS[n] ?? `$${n}`).join(' ');
  return move + (pos ? ` ${pos}` : '');
}
