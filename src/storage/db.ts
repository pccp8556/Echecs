import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { Folder, GameRecord, Repertoire } from '../core/repertoire/types';
import type { ReviewCard } from '../core/srs/srs';
import type { AttemptLog, SessionConfig, SessionState } from '../core/review/types';

export const DB_NAME = 'paul-aurait-trouve';
export const DB_VERSION = 1;

export interface StoredLog extends AttemptLog {
  id?: number;
}

/** Sessions enregistrées des versions précédentes : conservées et sauvegardées, plus proposées. */
export interface SavedPreset {
  id: string;
  name: string;
  config: SessionConfig;
  createdAt: number;
  updatedAt: number;
  lastUsedAt?: number;
}

export interface Revision {
  id: string;
  repertoireId: string;
  repertoireName: string;
  createdAt: number;
  reason: string;
  /** Instantané complet des parties au moment de la sauvegarde. */
  games: GameRecord[];
  marks: Record<string, string>;
}

export interface TrashEntry {
  id: string;
  deletedAt: number;
  repertoire: Repertoire;
  games: GameRecord[];
  cards: ReviewCard[];
}

export interface MetaEntry {
  key: string;
  value: unknown;
}

interface Schema extends DBSchema {
  repertoires: { key: string; value: Repertoire };
  games: { key: string; value: GameRecord; indexes: { byRepertoire: string } };
  folders: { key: string; value: Folder };
  cards: { key: string; value: ReviewCard; indexes: { byRepertoire: string } };
  logs: { key: number; value: StoredLog; indexes: { byTs: number; byRepertoire: string; byCard: string; bySession: string } };
  sessions: { key: string; value: SessionState; indexes: { byUpdated: number } };
  presets: { key: string; value: SavedPreset };
  revisions: { key: string; value: Revision; indexes: { byRepertoire: string } };
  trash: { key: string; value: TrashEntry };
  meta: { key: string; value: MetaEntry };
}

export type DB = IDBPDatabase<Schema>;

let dbPromise: Promise<DB> | null = null;

export function getDb(): Promise<DB> {
  if (!dbPromise) {
    dbPromise = openDB<Schema>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains('repertoires')) db.createObjectStore('repertoires', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('games')) db.createObjectStore('games', { keyPath: 'id' }).createIndex('byRepertoire', 'repertoireId');
        if (!db.objectStoreNames.contains('folders')) db.createObjectStore('folders', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('cards')) db.createObjectStore('cards', { keyPath: 'id' }).createIndex('byRepertoire', 'repertoireId');
        if (!db.objectStoreNames.contains('logs')) {
          const s = db.createObjectStore('logs', { keyPath: 'id', autoIncrement: true });
          s.createIndex('byTs', 'ts');
          s.createIndex('byRepertoire', 'repertoireId');
          s.createIndex('byCard', 'cardId');
          s.createIndex('bySession', 'sessionId');
        }
        if (!db.objectStoreNames.contains('sessions')) db.createObjectStore('sessions', { keyPath: 'id' }).createIndex('byUpdated', 'updatedAt');
        if (!db.objectStoreNames.contains('presets')) db.createObjectStore('presets', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('revisions')) db.createObjectStore('revisions', { keyPath: 'id' }).createIndex('byRepertoire', 'repertoireId');
        if (!db.objectStoreNames.contains('trash')) db.createObjectStore('trash', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'key' });
      },
      blocked() {
        console.warn('Base de données bloquée par un autre onglet.');
      },
    });
  }
  return dbPromise;
}

/** Ferme et oublie la connexion (tests, restauration). */
export async function resetDbConnection() {
  if (dbPromise) {
    (await dbPromise).close();
    dbPromise = null;
  }
}

/** Demande au navigateur de ne pas effacer les données automatiquement. */
export async function requestPersistence(): Promise<boolean | null> {
  try {
    if (typeof navigator !== 'undefined' && navigator.storage?.persist) {
      if (await navigator.storage.persisted()) return true;
      return await navigator.storage.persist();
    }
  } catch {
    /* non disponible */
  }
  return null;
}

export async function storageEstimate(): Promise<{ usage: number; quota: number } | null> {
  try {
    if (typeof navigator !== 'undefined' && navigator.storage?.estimate) {
      const e = await navigator.storage.estimate();
      return { usage: e.usage ?? 0, quota: e.quota ?? 0 };
    }
  } catch {
    /* non disponible */
  }
  return null;
}
