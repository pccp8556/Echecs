import type { Color } from '../chess/fen';
import type { GameRoot, HeaderList, PgnIssue } from '../pgn/types';

/** Qualification personnelle d'une ligne (attachée à un chemin de l'arbre fusionné). */
export type LineMark = 'main' | 'secondary' | 'experimental' | 'learn' | 'mastered' | 'review' | 'abandoned';

export const LINE_MARKS: Record<LineMark, { label: string; hint: string }> = {
  main: { label: 'Principale', hint: 'Ligne de référence du répertoire' },
  secondary: { label: 'Secondaire', hint: 'Alternative moins jouée' },
  experimental: { label: 'Expérimentale', hint: 'Idée à tester' },
  learn: { label: 'À apprendre', hint: 'À étudier prochainement' },
  mastered: { label: 'Maîtrisée', hint: 'Marquée comme connue par toi' },
  review: { label: 'À revoir', hint: 'À retravailler en priorité' },
  abandoned: { label: 'Abandonnée', hint: 'Exclue des révisions, conservée dans le PGN' },
};

export type SourceKind = 'file' | 'paste' | 'github' | 'url' | 'demo' | 'merge' | 'duplicate' | 'new' | 'backup';

export interface GithubSource {
  owner: string;
  repo: string;
  path: string;
  ref: string;
  /** SHA du blob Git lors du dernier import (détection de changements distants). */
  sha?: string;
  private?: boolean;
}

export interface SourceInfo {
  kind: SourceKind;
  fileName?: string;
  url?: string;
  github?: GithubSource;
  etag?: string;
  /** Date de modification du fichier local (File.lastModified) si connue. */
  fileLastModified?: number;
  importedAt: number;
  /** Empreinte du texte importé, pour détecter qu'une source a changé. */
  contentHash: string;
}

export interface RepertoireStats {
  games: number;
  validGames: number;
  moves: number;
  positions: number;
  lines: number;
  variations: number;
  comments: number;
  errors: number;
  warnings: number;
  invalidMoves: number;
}

export interface Repertoire {
  id: string;
  name: string;
  description?: string;
  folderId: string | null;
  tags: string[];
  favorite: boolean;
  /** Camp joué par l'utilisateur : 'auto' utilise la détection. */
  color: Color | 'auto';
  detectedColor: Color;
  source: SourceInfo;
  createdAt: number;
  updatedAt: number;
  lastReviewedAt?: number;
  lastOpenedAt?: number;
  stats: RepertoireStats;
  /** Marques personnelles par chemin de l'arbre fusionné. */
  marks: Record<string, LineMark>;
  /** Le contenu a été modifié depuis l'import (édition dans l'application). */
  modified: boolean;
  /** Ordre d'affichage des parties. */
  gameOrder: string[];
}

export interface GameRecord {
  id: string;
  repertoireId: string;
  headers: HeaderList;
  root: GameRoot;
  /** Texte PGN d'origine, exporté tel quel tant que la partie n'est pas modifiée. */
  rawPgn: string;
  modified: boolean;
  fatal: boolean;
  issues: PgnIssue[];
  maxId: number;
  /** Camp joué pour cette partie, si différent de celui du répertoire. */
  color?: Color;
  updatedAt: number;
}

export interface Folder {
  id: string;
  name: string;
  createdAt: number;
}

export function repertoireColor(r: Pick<Repertoire, 'color' | 'detectedColor'>): Color {
  return r.color === 'auto' ? r.detectedColor : r.color;
}

export function header(headers: HeaderList, key: string): string {
  const v = headers.find(([k]) => k === key)?.[1]?.trim() ?? '';
  return v === '?' ? '' : v;
}
