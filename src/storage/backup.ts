import { getDb, type Revision, type SavedPreset, type StoredLog } from './db';
import type { Folder, GameRecord, Repertoire } from '../core/repertoire/types';
import type { ReviewCard } from '../core/srs/srs';
import type { SessionState } from '../core/review/types';

export const BACKUP_APP = 'paul-aurait-trouve';
export const BACKUP_VERSION = 1;

export interface BackupData {
  repertoires: Repertoire[];
  games: GameRecord[];
  folders: Folder[];
  cards: ReviewCard[];
  logs: StoredLog[];
  sessions: SessionState[];
  presets: SavedPreset[];
  revisions: Revision[];
  settings?: Record<string, unknown>;
}

export interface BackupFile {
  app: typeof BACKUP_APP;
  version: number;
  exportedAt: number;
  data: BackupData;
}

export async function exportBackup(opts: { includeRevisions?: boolean; settings?: Record<string, unknown> } = {}): Promise<BackupFile> {
  const db = await getDb();
  const [repertoires, games, folders, cards, logs, sessions, presets, revisions] = await Promise.all([
    db.getAll('repertoires'),
    db.getAll('games'),
    db.getAll('folders'),
    db.getAll('cards'),
    db.getAll('logs'),
    db.getAll('sessions'),
    db.getAll('presets'),
    opts.includeRevisions ? db.getAll('revisions') : Promise.resolve([] as Revision[]),
  ]);
  return {
    app: BACKUP_APP,
    version: BACKUP_VERSION,
    exportedAt: Date.now(),
    data: { repertoires, games, folders, cards, logs, sessions, presets, revisions, settings: opts.settings },
  };
}

export class BackupError extends Error {}

/** Vérifie qu'un objet est bien une sauvegarde de l'application. */
export function validateBackup(obj: unknown): BackupFile {
  if (!obj || typeof obj !== 'object') throw new BackupError('Fichier illisible : ce n’est pas un JSON de sauvegarde.');
  const f = obj as Partial<BackupFile>;
  if (f.app !== BACKUP_APP) throw new BackupError('Ce fichier ne provient pas de Paul aurait trouvé.');
  if (typeof f.version !== 'number' || f.version > BACKUP_VERSION) throw new BackupError('Version de sauvegarde non prise en charge (sauvegarde plus récente que l’application ?).');
  const d = f.data as Partial<BackupData> | undefined;
  if (!d || !Array.isArray(d.repertoires) || !Array.isArray(d.games)) throw new BackupError('Sauvegarde incomplète : répertoires ou parties manquants.');
  for (const r of d.repertoires) if (!r || typeof r.id !== 'string' || typeof r.name !== 'string') throw new BackupError('Répertoire invalide dans la sauvegarde.');
  for (const g of d.games) if (!g || typeof g.id !== 'string' || typeof g.repertoireId !== 'string' || !g.root) throw new BackupError('Partie invalide dans la sauvegarde.');
  const data: BackupData = {
    repertoires: d.repertoires,
    games: d.games,
    folders: Array.isArray(d.folders) ? d.folders : [],
    cards: Array.isArray(d.cards) ? d.cards : [],
    logs: Array.isArray(d.logs) ? d.logs : [],
    sessions: Array.isArray(d.sessions) ? d.sessions : [],
    presets: Array.isArray(d.presets) ? d.presets : [],
    revisions: Array.isArray(d.revisions) ? d.revisions : [],
    settings: d.settings,
  };
  return { app: BACKUP_APP, version: f.version, exportedAt: f.exportedAt ?? 0, data };
}

export interface RestoreSummary {
  repertoires: number;
  games: number;
  cards: number;
  logs: number;
}

/**
 * Restaure une sauvegarde. « replace » efface d'abord les données actuelles ;
 * « merge » ajoute ou remplace les éléments ayant le même identifiant.
 */
export async function importBackup(file: BackupFile, mode: 'merge' | 'replace'): Promise<RestoreSummary> {
  const db = await getDb();
  const stores = ['repertoires', 'games', 'folders', 'cards', 'logs', 'sessions', 'presets', 'revisions'] as const;
  const tx = db.transaction([...stores], 'readwrite');
  if (mode === 'replace') for (const s of stores) await tx.objectStore(s).clear();
  const d = file.data;
  for (const r of d.repertoires) await tx.objectStore('repertoires').put(r);
  for (const g of d.games) await tx.objectStore('games').put(g);
  for (const f of d.folders) await tx.objectStore('folders').put(f);
  for (const c of d.cards) await tx.objectStore('cards').put(c);
  const logStore = tx.objectStore('logs');
  if (mode === 'merge') {
    // Évite les doublons de journal lors d'une fusion.
    const existing = new Set((await logStore.getAll()).map((l) => `${l.ts}|${l.cardId}|${l.sessionId}`));
    for (const l of d.logs) {
      const k = `${l.ts}|${l.cardId}|${l.sessionId}`;
      if (existing.has(k)) continue;
      const { id: _drop, ...rest } = l;
      void _drop;
      await logStore.add(rest);
    }
  } else for (const l of d.logs) await logStore.put(l);
  for (const s of d.sessions) await tx.objectStore('sessions').put(s);
  for (const p of d.presets) await tx.objectStore('presets').put(p);
  for (const r of d.revisions) await tx.objectStore('revisions').put(r);
  await tx.done;
  return { repertoires: d.repertoires.length, games: d.games.length, cards: d.cards.length, logs: d.logs.length };
}
