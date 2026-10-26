import { getDb, type Revision, type SavedPreset, type StoredLog, type TrashEntry } from './db';
import type { Folder, GameRecord, Repertoire } from '../core/repertoire/types';
import { applyReview, newCard, resetScheduling, type Grade4, type ReviewCard } from '../core/srs/srs';
import type { SessionState } from '../core/review/types';
import { buildForest } from '../core/repertoire/merged';
import { answersSignature, buildPositionIndex } from '../core/repertoire/positions';
import { computeStats, newId } from '../core/repertoire/build';

const MAX_REVISIONS = 25;

/* ---------------- Répertoires & parties ---------------- */

export async function listRepertoires(): Promise<Repertoire[]> {
  const db = await getDb();
  return db.getAll('repertoires');
}

export async function getRepertoire(id: string): Promise<Repertoire | undefined> {
  return (await getDb()).get('repertoires', id);
}

export async function getGames(repertoireId: string): Promise<GameRecord[]> {
  const db = await getDb();
  return db.getAllFromIndex('games', 'byRepertoire', repertoireId);
}

export async function saveNewRepertoire(rep: Repertoire, games: GameRecord[]): Promise<void> {
  const db = await getDb();
  const tx = db.transaction(['repertoires', 'games'], 'readwrite');
  await tx.objectStore('repertoires').put(rep);
  for (const g of games) await tx.objectStore('games').put(g);
  await tx.done;
}

export async function updateRepertoireMeta(rep: Repertoire): Promise<void> {
  await (await getDb()).put('repertoires', rep);
}

/**
 * Enregistre de nouvelles versions des parties d'un répertoire. Un instantané
 * de l'état précédent est conservé dans l'historique des révisions avant toute
 * écriture, afin de pouvoir revenir en arrière.
 */
export async function saveRepertoireContent(rep: Repertoire, games: GameRecord[], reason: string): Promise<Repertoire> {
  const db = await getDb();
  const previous = await getGames(rep.id);
  const prevRep = await getRepertoire(rep.id);
  if (prevRep && previous.length) await addRevision(prevRep, previous, reason);
  const updated: Repertoire = { ...rep, stats: computeStats(games), updatedAt: Date.now(), gameOrder: rep.gameOrder.filter((id) => games.some((g) => g.id === id)) };
  for (const g of games) if (!updated.gameOrder.includes(g.id)) updated.gameOrder.push(g.id);
  const tx = db.transaction(['repertoires', 'games'], 'readwrite');
  const keep = new Set(games.map((g) => g.id));
  for (const old of previous) if (!keep.has(old.id)) await tx.objectStore('games').delete(old.id);
  for (const g of games) await tx.objectStore('games').put(g);
  await tx.objectStore('repertoires').put(updated);
  await tx.done;
  await reconcileCards(updated, games);
  return updated;
}

/**
 * Après une modification du PGN : une position qui n'existe plus devient
 * « obsolète » (historique conservé mais exclu) ; si les coups attendus ont
 * changé, la planification est réinitialisée au lieu d'être transférée.
 */
export async function reconcileCards(rep: Repertoire, games: GameRecord[]): Promise<{ obsolete: number; reset: number; restored: number }> {
  const db = await getDb();
  const index = buildPositionIndex(buildForest(games));
  const cards = await db.getAllFromIndex('cards', 'byRepertoire', rep.id);
  const now = Date.now();
  let obsolete = 0;
  let reset = 0;
  let restored = 0;
  const tx = db.transaction('cards', 'readwrite');
  for (const c of cards) {
    const info = index.get(c.posKey);
    if (!info || !info.moves.length) {
      if (!c.obsolete) {
        obsolete++;
        await tx.store.put({ ...c, obsolete: true });
      }
      continue;
    }
    const sig = answersSignature(info);
    let next = c;
    if (c.obsolete) {
      restored++;
      next = { ...next, obsolete: false };
    }
    if (sig !== c.answers) {
      reset++;
      next = resetScheduling(next, sig, now);
    }
    if (next !== c) await tx.store.put(next);
  }
  await tx.done;
  return { obsolete, reset, restored };
}

/** Supprime un répertoire en le plaçant dans la corbeille (restaurable). */
export async function deleteRepertoire(id: string): Promise<void> {
  const db = await getDb();
  const rep = await getRepertoire(id);
  if (!rep) return;
  const games = await getGames(id);
  const cards = await db.getAllFromIndex('cards', 'byRepertoire', id);
  const entry: TrashEntry = { id: rep.id, deletedAt: Date.now(), repertoire: rep, games, cards };
  const tx = db.transaction(['repertoires', 'games', 'cards', 'trash'], 'readwrite');
  await tx.objectStore('trash').put(entry);
  for (const g of games) await tx.objectStore('games').delete(g.id);
  for (const c of cards) await tx.objectStore('cards').delete(c.id);
  await tx.objectStore('repertoires').delete(id);
  await tx.done;
}

export async function listTrash(): Promise<TrashEntry[]> {
  return (await getDb()).getAll('trash');
}

export async function restoreFromTrash(id: string): Promise<void> {
  const db = await getDb();
  const entry = await db.get('trash', id);
  if (!entry) return;
  const tx = db.transaction(['repertoires', 'games', 'cards', 'trash'], 'readwrite');
  await tx.objectStore('repertoires').put(entry.repertoire);
  for (const g of entry.games) await tx.objectStore('games').put(g);
  for (const c of entry.cards) await tx.objectStore('cards').put(c);
  await tx.objectStore('trash').delete(id);
  await tx.done;
}

export async function purgeTrash(id?: string): Promise<void> {
  const db = await getDb();
  if (id) await db.delete('trash', id);
  else await db.clear('trash');
}

/** Copie indépendante d'un répertoire (nouveaux identifiants, sans progression). */
export async function duplicateRepertoire(id: string, name: string): Promise<Repertoire | undefined> {
  const rep = await getRepertoire(id);
  if (!rep) return;
  const games = await getGames(id);
  const newRepId = newId();
  const now = Date.now();
  const mapIds = new Map<string, string>();
  const copies = games.map((g) => {
    const nid = newId();
    mapIds.set(g.id, nid);
    return { ...structuredClone(g), id: nid, repertoireId: newRepId, updatedAt: now };
  });
  const copy: Repertoire = {
    ...structuredClone(rep),
    id: newRepId,
    name,
    createdAt: now,
    updatedAt: now,
    lastReviewedAt: undefined,
    source: { ...rep.source, kind: 'duplicate', importedAt: now },
    gameOrder: rep.gameOrder.map((g) => mapIds.get(g) ?? g),
  };
  await saveNewRepertoire(copy, copies);
  return copy;
}

/** Fusionne plusieurs répertoires dans un nouveau (les originaux sont conservés). */
export async function mergeRepertoires(ids: string[], name: string): Promise<Repertoire | undefined> {
  const reps = (await Promise.all(ids.map(getRepertoire))).filter((r): r is Repertoire => !!r);
  if (!reps.length) return;
  const newRepId = newId();
  const now = Date.now();
  const games: GameRecord[] = [];
  const marks: Record<string, Repertoire['marks'][string]> = {};
  for (const r of reps) {
    const gs = await getGames(r.id);
    const ordered = r.gameOrder.map((gid) => gs.find((g) => g.id === gid)).filter((g): g is GameRecord => !!g);
    for (const g of ordered) games.push({ ...structuredClone(g), id: newId(), repertoireId: newRepId, updatedAt: now });
    Object.assign(marks, r.marks);
  }
  const rep: Repertoire = {
    ...structuredClone(reps[0]),
    id: newRepId,
    name,
    folderId: reps[0].folderId,
    tags: [...new Set(reps.flatMap((r) => r.tags))],
    favorite: false,
    source: { kind: 'merge', importedAt: now, contentHash: '' },
    createdAt: now,
    updatedAt: now,
    lastReviewedAt: undefined,
    stats: computeStats(games),
    marks,
    modified: true,
    gameOrder: games.map((g) => g.id),
  };
  await saveNewRepertoire(rep, games);
  return rep;
}

/* ---------------- Dossiers ---------------- */

export async function listFolders(): Promise<Folder[]> {
  return (await getDb()).getAll('folders');
}

export async function saveFolder(f: Folder): Promise<void> {
  await (await getDb()).put('folders', f);
}

export async function deleteFolder(id: string): Promise<void> {
  const db = await getDb();
  const reps = await listRepertoires();
  const tx = db.transaction(['folders', 'repertoires'], 'readwrite');
  for (const r of reps) if (r.folderId === id) await tx.objectStore('repertoires').put({ ...r, folderId: null });
  await tx.objectStore('folders').delete(id);
  await tx.done;
}

/* ---------------- Révisions (historique des versions) ---------------- */

export async function addRevision(rep: Repertoire, games: GameRecord[], reason: string): Promise<void> {
  const db = await getDb();
  const rev: Revision = { id: newId(), repertoireId: rep.id, repertoireName: rep.name, createdAt: Date.now(), reason, games, marks: rep.marks };
  await db.put('revisions', rev);
  const all = (await db.getAllFromIndex('revisions', 'byRepertoire', rep.id)).sort((a, b) => b.createdAt - a.createdAt);
  for (const old of all.slice(MAX_REVISIONS)) await db.delete('revisions', old.id);
}

export async function listRevisions(repertoireId: string): Promise<Revision[]> {
  const all = await (await getDb()).getAllFromIndex('revisions', 'byRepertoire', repertoireId);
  return all.sort((a, b) => b.createdAt - a.createdAt);
}

export async function restoreRevision(revisionId: string): Promise<Repertoire | undefined> {
  const db = await getDb();
  const rev = await db.get('revisions', revisionId);
  if (!rev) return;
  const rep = await getRepertoire(rev.repertoireId);
  if (!rep) return;
  return saveRepertoireContent({ ...rep, marks: rev.marks as Repertoire['marks'], modified: true }, rev.games, `Avant restauration de la version du ${new Date(rev.createdAt).toLocaleString('fr-FR')}`);
}

/* ---------------- Cartes de révision ---------------- */

export async function getCards(repertoireId?: string): Promise<ReviewCard[]> {
  const db = await getDb();
  return repertoireId ? db.getAllFromIndex('cards', 'byRepertoire', repertoireId) : db.getAll('cards');
}

export async function putCards(cards: ReviewCard[]): Promise<void> {
  const db = await getDb();
  const tx = db.transaction('cards', 'readwrite');
  for (const c of cards) await tx.store.put(c);
  await tx.done;
}

export async function updateCard(id: string, fn: (c: ReviewCard) => ReviewCard): Promise<ReviewCard | undefined> {
  const db = await getDb();
  const c = await db.get('cards', id);
  if (!c) return;
  const next = fn(c);
  await db.put('cards', next);
  return next;
}

export interface GradeRequest {
  cardId: string;
  repertoireId: string;
  posKey: string;
  fen: string;
  turn: 'w' | 'b';
  answers: string;
  grade: Grade4;
  result: ReviewCard['lastResult'] & string;
  timeMs: number;
  hints: number;
  now: number;
  countsInStats: boolean;
}

/** Applique une note FSRS ; crée la carte si nécessaire. Retourne l'état précédent (pour corriger la note). */
export async function gradeCard(req: GradeRequest): Promise<{ before: ReviewCard | undefined; after: ReviewCard }> {
  const db = await getDb();
  const before = await db.get('cards', req.cardId);
  const base = before ?? newCard(req.repertoireId, req.posKey, req.fen, req.turn, req.answers, req.now);
  const after = applyReview(base, { grade: req.grade, result: req.result, timeMs: req.timeMs, hints: req.hints, now: req.now, countsInStats: req.countsInStats });
  await db.put('cards', after);
  return { before, after };
}

/* ---------------- Journal des réponses ---------------- */

export async function addLogs(logs: StoredLog[]): Promise<void> {
  if (!logs.length) return;
  const db = await getDb();
  const tx = db.transaction('logs', 'readwrite');
  for (const l of logs) await tx.store.add(l);
  await tx.done;
}

export async function getLogs(opts: { since?: number; until?: number; repertoireId?: string } = {}): Promise<StoredLog[]> {
  const db = await getDb();
  let logs: StoredLog[];
  if (opts.since != null || opts.until != null) {
    const range = IDBKeyRange.bound(opts.since ?? 0, opts.until ?? Number.MAX_SAFE_INTEGER);
    logs = await db.getAllFromIndex('logs', 'byTs', range);
  } else logs = await db.getAll('logs');
  return opts.repertoireId ? logs.filter((l) => l.repertoireId === opts.repertoireId) : logs;
}

/* ---------------- Sessions ---------------- */

export async function saveSession(s: SessionState): Promise<void> {
  await (await getDb()).put('sessions', s);
}

export async function getSession(id: string): Promise<SessionState | undefined> {
  return (await getDb()).get('sessions', id);
}

export async function listSessions(): Promise<SessionState[]> {
  const all = await (await getDb()).getAll('sessions');
  return all.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function deleteSession(id: string): Promise<void> {
  await (await getDb()).delete('sessions', id);
}

/** Dernière session non terminée (pour « Reprendre ma session »). */
export async function getResumableSession(): Promise<SessionState | undefined> {
  return (await listSessions()).find((s) => s.phase !== 'finished');
}

/* ---------------- Préréglages enregistrés ---------------- */

export async function listPresets(): Promise<SavedPreset[]> {
  return (await (await getDb()).getAll('presets')).sort((a, b) => (b.lastUsedAt ?? b.updatedAt) - (a.lastUsedAt ?? a.updatedAt));
}

export async function savePreset(p: SavedPreset): Promise<void> {
  await (await getDb()).put('presets', p);
}

export async function deletePreset(id: string): Promise<void> {
  await (await getDb()).delete('presets', id);
}

/* ---------------- Méta ---------------- */

export async function getMeta<T>(key: string): Promise<T | undefined> {
  return (await (await getDb()).get('meta', key))?.value as T | undefined;
}

export async function setMeta(key: string, value: unknown): Promise<void> {
  await (await getDb()).put('meta', { key, value });
}

export async function deleteMeta(key: string): Promise<void> {
  await (await getDb()).delete('meta', key);
}
