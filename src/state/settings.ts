import { create } from 'zustand';
import type { NotationStyle } from '../core/chess/notation';
import type { FeedbackStyle } from '../core/review/types';
import type { PieceSetId } from '../ui/board/pieces';

export interface Settings {
  theme: 'dark' | 'light' | 'system';
  fontScale: number;
  motion: 'system' | 'on' | 'off';
  boardTheme: string;
  pieceSet: PieceSetId;
  coordinates: boolean;
  notation: NotationStyle;
  feedbackStyle: FeedbackStyle;
  newLimit: number;
  askConfidence: boolean;
  /** Après une erreur, un second essai avant de montrer la solution. */
  secondChance: boolean;
  engineEnabled: boolean;
  githubRememberToken: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  theme: 'dark',
  fontScale: 1,
  motion: 'system',
  boardTheme: 'emeraude',
  pieceSet: 'cburnett',
  coordinates: true,
  notation: 'fr',
  feedbackStyle: 'humorous',
  newLimit: 10,
  askConfidence: false,
  secondChance: false,
  engineEnabled: true,
  githubRememberToken: false,
};

const KEY = 'pat.settings.v1';

function load(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<Settings>;
    // Seules les préférences encore proposées sont reprises (les anciennes sont ignorées).
    const known = Object.fromEntries(Object.entries(parsed).filter(([k]) => k in DEFAULT_SETTINGS));
    return { ...DEFAULT_SETTINGS, ...known };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

function save(s: Settings) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* stockage indisponible (navigation privée) : réglages non persistés */
  }
}

interface SettingsStore {
  settings: Settings;
  set: (patch: Partial<Settings>) => void;
  reset: () => void;
  replace: (s: Partial<Settings>) => void;
}

export const useSettings = create<SettingsStore>((set, get) => ({
  settings: load(),
  set: (patch) => {
    const next = { ...get().settings, ...patch };
    save(next);
    set({ settings: next });
    applySettings(next);
  },
  reset: () => {
    save(DEFAULT_SETTINGS);
    set({ settings: DEFAULT_SETTINGS });
    applySettings(DEFAULT_SETTINGS);
  },
  replace: (s) => {
    const next = { ...DEFAULT_SETTINGS, ...Object.fromEntries(Object.entries(s).filter(([k]) => k in DEFAULT_SETTINGS)) };
    save(next);
    set({ settings: next });
    applySettings(next);
  },
}));

let mql: MediaQueryList | null = null;

/** Applique thème, taille de police et animations sur le document. */
export function applySettings(s: Settings) {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  const resolveTheme = () => (s.theme === 'system' ? (window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark') : s.theme);
  root.dataset.theme = resolveTheme();
  if (s.theme === 'system' && window.matchMedia) {
    mql?.removeEventListener?.('change', onSchemeChange);
    mql = window.matchMedia('(prefers-color-scheme: light)');
    mql.addEventListener?.('change', onSchemeChange);
  }
  root.style.setProperty('--font-scale', String(s.fontScale));
  if (s.motion === 'system') delete root.dataset.motion;
  else root.dataset.motion = s.motion;
  const meta = document.querySelector('meta[name="theme-color"]');
  meta?.setAttribute('content', root.dataset.theme === 'light' ? '#f2f5f4' : '#0a0f14');
}

function onSchemeChange() {
  applySettings(useSettings.getState().settings);
}

export function animationsEnabled(s: Settings): boolean {
  if (s.motion === 'off') return false;
  if (s.motion === 'on') return true;
  return !(typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
}
