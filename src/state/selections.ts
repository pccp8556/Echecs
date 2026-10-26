import { create } from 'zustand';
import { fullSelection, type RepertoireSelection } from '../core/repertoire/selection';

const KEY = 'pat.selections.v1';

function load(): Record<string, RepertoireSelection> {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '{}') as Record<string, RepertoireSelection>;
  } catch {
    return {};
  }
}

interface SelStore {
  byRep: Record<string, RepertoireSelection>;
  get: (repId: string) => RepertoireSelection;
  set: (sel: RepertoireSelection) => void;
  reset: (repId: string) => void;
}

/** Sélection de travail de chaque répertoire (préférence locale, rechargée à l'ouverture). */
export const useSelections = create<SelStore>((set, get) => ({
  byRep: load(),
  get: (repId) => get().byRep[repId] ?? fullSelection(repId),
  set: (sel) => {
    const byRep = { ...get().byRep, [sel.repertoireId]: sel };
    try {
      localStorage.setItem(KEY, JSON.stringify(byRep));
    } catch {
      /* préférence non persistée */
    }
    set({ byRep });
  },
  reset: (repId) => {
    const byRep = { ...get().byRep };
    delete byRep[repId];
    try {
      localStorage.setItem(KEY, JSON.stringify(byRep));
    } catch {
      /* ignore */
    }
    set({ byRep });
  },
}));
