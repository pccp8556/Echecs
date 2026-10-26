/**
 * Modèle d'arbre de coups d'une partie PGN.
 *
 * Chaque nœud représente un coup ; `children[0]` est la suite principale et les
 * enfants suivants sont les variantes (dans l'ordre du PGN). La racine porte la
 * position de départ (FEN de l'en-tête ou position initiale).
 */

export type ShapeColor = 'G' | 'R' | 'Y' | 'B';

export interface Shape {
  color: ShapeColor;
  from: string;
  /** Absent pour un cercle (case colorée, `%csl`), présent pour une flèche (`%cal`). */
  to?: string;
}

export interface InvalidMove {
  /** Notation du coup refusé, telle qu'écrite dans le PGN (avec numéro). */
  head: string;
  /** Suite de la variante qui n'a pas pu être rejouée, conservée en texte PGN. */
  tail: string;
  /** Explication en français. */
  error: string;
}

export interface MoveNode {
  /** Identifiant numérique unique dans la partie (stable pendant l'édition). */
  id: number;
  /** SAN canonique (anglais, format PGN). */
  san: string;
  /** Coup au format UCI (e2e4, e7e8q). Vide pour un coup invalide. */
  uci: string;
  /** FEN complète après le coup (pour un coup invalide : FEN avant le coup). */
  fen: string;
  nags?: number[];
  /** Commentaires placés avant le coup (début de variante). */
  commentsBefore?: string[];
  /** Commentaires après le coup (texte, sans les commandes [%...]). */
  comments?: string[];
  /** Flèches et cases colorées (%cal / %csl). */
  shapes?: Shape[];
  /** Autres commandes conservées telles quelles : clk, eval, emt… */
  commands?: Record<string, string>;
  children: MoveNode[];
  /** Présent si le coup est illégal ou illisible : il est conservé mais exclu des révisions. */
  invalid?: InvalidMove;
}

export interface GameRoot {
  /** FEN de départ (complète). */
  fen: string;
  /** Commentaire placé avant le premier coup. */
  comments?: string[];
  shapes?: Shape[];
  commands?: Record<string, string>;
  children: MoveNode[];
}

export type HeaderList = Array<[string, string]>;

export type IssueSeverity = 'error' | 'warning';

export interface PgnIssue {
  severity: IssueSeverity;
  message: string;
  /** Index de la partie dans le fichier (0-based). */
  gameIndex: number;
  gameLabel: string;
  /** Ligne / colonne dans le fichier d'origine (1-based) si connues. */
  line?: number;
  column?: number;
  /** Coup concerné, ex. « 12...Cxe4 ». */
  moveLabel?: string;
}

export interface ParsedGame {
  headers: HeaderList;
  root: GameRoot;
  /** Texte PGN original de la partie, conservé tel quel. */
  rawPgn: string;
  /** La partie n'a pas pu être analysée du tout (erreur de syntaxe ou FEN invalide). */
  fatal: boolean;
  issues: PgnIssue[];
  /** Plus grand identifiant de nœud utilisé. */
  maxId: number;
}

export interface ParseReport {
  games: number;
  validGames: number;
  positions: number;
  moves: number;
  lines: number;
  variations: number;
  comments: number;
  shapes: number;
  invalidMoves: number;
  issues: PgnIssue[];
  durationMs: number;
}

export interface ParsedFile {
  games: ParsedGame[];
  report: ParseReport;
}
