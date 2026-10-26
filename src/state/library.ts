import { create } from 'zustand';
import type { Folder, GameRecord, LineMark, Repertoire } from '../core/repertoire/types';
import type { ReviewCard } from '../core/srs/srs';
import * as repo from '../storage/repo';
import { requestPersistence } from '../storage/db';
import { newId, orderedGames } from '../core/repertoire/build';

interface LibraryStore {
  loaded: boolean;
  error?: string;
  repertoires: Repertoire[];
  folders: Folder[];
  cards: Map<string, ReviewCard>;
  games: Record<string, GameRecord[]>;
  persistent: boolean | null;
  load: () => Promise<void>;
  refresh: () => Promise<void>;
  loadGames: (repertoireId: string, force?: boolean) => Promise<GameRecord[]>;
  addRepertoire: (rep: Repertoire, games: GameRecord[]) => Promise<void>;
  updateMeta: (id: string, patch: Partial<Repertoire>) => Promise<Repertoire | undefined>;
  saveContent: (rep: Repertoire, games: GameRecord[], reason: string) => Promise<Repertoire>;
  setMark: (id: string, key: string, mark: LineMark | null) => Promise<void>;
  remove: (id: string) => Promise<void>;
  duplicate: (id: string, name: string) => Promise<Repertoire | undefined>;
  merge: (ids: string[], name: string) => Promise<Repertoire | undefined>;
  createFolder: (name: string) => Promise<Folder>;
  renameFolder: (id: string, name: string) => Promise<void>;
  deleteFolder: (id: string) => Promise<void>;
  setCards: (cards: ReviewCard[]) => void;
  reloadCards: () => Promise<void>;
}

export const useLibrary = create<LibraryStore>((set, get) => ({
  loaded: false,
  repertoires: [],
  folders: [],
  cards: new Map(),
  games: {},
  persistent: null,
  load: async () => {
    if (get().loaded) return;
    await get().refresh();
    requestPersistence().then((p) => set({ persistent: p }));
  },
  refresh: async () => {
    try {
      const [repertoires, folders, cards] = await Promise.all([repo.listRepertoires(), repo.listFolders(), repo.getCards()]);
      set({
        loaded: true,
        error: undefined,
        repertoires: repertoires.sort((a, b) => (b.lastOpenedAt ?? b.updatedAt) - (a.lastOpenedAt ?? a.updatedAt)),
        folders: folders.sort((a, b) => a.name.localeCompare(b.name, 'fr')),
        cards: new Map(cards.map((c) => [c.id, c])),
      });
    } catch (e) {
      set({ loaded: true, error: e instanceof Error ? e.message : 'Stockage local indisponible' });
    }
  },
  loadGames: async (repertoireId, force) => {
    const cached = get().games[repertoireId];
    if (cached && !force) return cached;
    const rep = get().repertoires.find((r) => r.id === repertoireId);
    const raw = await repo.getGames(repertoireId);
    const games = rep ? orderedGames(rep, raw) : raw;
    set({ games: { ...get().games, [repertoireId]: games } });
    return games;
  },
  addRepertoire: async (rep, games) => {
    await repo.saveNewRepertoire(rep, games);
    set({ repertoires: [rep, ...get().repertoires], games: { ...get().games, [rep.id]: games } });
  },
  updateMeta: async (id, patch) => {
    const cur = get().repertoires.find((r) => r.id === id) ?? (await repo.getRepertoire(id));
    if (!cur) return;
    const next = { ...cur, ...patch };
    await repo.updateRepertoireMeta(next);
    set({ repertoires: get().repertoires.map((r) => (r.id === id ? next : r)) });
    return next;
  },
  saveContent: async (rep, games, reason) => {
    const updated = await repo.saveRepertoireContent(rep, games, reason);
    const cards = await repo.getCards();
    set({
      repertoires: get().repertoires.map((r) => (r.id === rep.id ? updated : r)),
      games: { ...get().games, [rep.id]: games },
      cards: new Map(cards.map((c) => [c.id, c])),
    });
    return updated;
  },
  setMark: async (id, key, mark) => {
    const cur = get().repertoires.find((r) => r.id === id);
    if (!cur) return;
    const marks = { ...cur.marks };
    if (mark) marks[key] = mark;
    else delete marks[key];
    await get().updateMeta(id, { marks });
  },
  remove: async (id) => {
    await repo.deleteRepertoire(id);
    const games = { ...get().games };
    delete games[id];
    const cards = new Map(get().cards);
    for (const k of [...cards.keys()]) if (k.startsWith(id + '|')) cards.delete(k);
    set({ repertoires: get().repertoires.filter((r) => r.id !== id), games, cards });
  },
  duplicate: async (id, name) => {
    const copy = await repo.duplicateRepertoire(id, name);
    if (copy) set({ repertoires: [copy, ...get().repertoires] });
    return copy;
  },
  merge: async (ids, name) => {
    const rep = await repo.mergeRepertoires(ids, name);
    if (rep) set({ repertoires: [rep, ...get().repertoires] });
    return rep;
  },
  createFolder: async (name) => {
    const f: Folder = { id: newId(), name, createdAt: Date.now() };
    await repo.saveFolder(f);
    set({ folders: [...get().folders, f].sort((a, b) => a.name.localeCompare(b.name, 'fr')) });
    return f;
  },
  renameFolder: async (id, name) => {
    const f = get().folders.find((x) => x.id === id);
    if (!f) return;
    await repo.saveFolder({ ...f, name });
    set({ folders: get().folders.map((x) => (x.id === id ? { ...x, name } : x)) });
  },
  deleteFolder: async (id) => {
    await repo.deleteFolder(id);
    set({
      folders: get().folders.filter((f) => f.id !== id),
      repertoires: get().repertoires.map((r) => (r.folderId === id ? { ...r, folderId: null } : r)),
    });
  },
  setCards: (cards) => {
    const map = new Map(get().cards);
    for (const c of cards) map.set(c.id, c);
    set({ cards: map });
  },
  reloadCards: async () => {
    const cards = await repo.getCards();
    set({ cards: new Map(cards.map((c) => [c.id, c])) });
  },
}));

export function cardsForRepertoire(cards: Map<string, ReviewCard>, repertoireId: string): ReviewCard[] {
  const out: ReviewCard[] = [];
  for (const c of cards.values()) if (c.repertoireId === repertoireId && !c.obsolete) out.push(c);
  return out;
}
