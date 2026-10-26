import { create } from 'zustand';
import type { NotationStyle } from '../core/chess/notation';
import type { ErrorPolicy, FeedbackStyle } from '../core/review/types';
import type { PieceSetId } from '../ui/board/pieces';
import { configureScheduler } from '../core/srs/srs';

export interface Settings {
  theme: 'dark' | 'light' | 'system';
  fontScale: number;
  motion: 'system' | 'on' | 'off';
  boardTheme: string;
  pieceSet: PieceSetId;
  coordinates: boolean;
  showLegal: boolean;
  boardSize: 'compact' | 'normal' | 'large' | 'max';
  notation: NotationStyle;
  feedbackStyle: FeedbackStyle;
  /** Délai avant le coup adverse (ms). */
  opponentDelayMs: number;
  /** Vitesse de relecture du contexte (ms par coup). */
  contextSpeedMs: number;
  /** Passage automatique à la position suivante après une bonne réponse (ms, 0 = manuel). */
  autoAdvanceMs: number;
  slowMs: number;
  fastMs: number;
  retention: number;
  newLimit: number;
  askConfidence: boolean;
  errorPolicy: ErrorPolicy;
  autoplaySpeedMs: number;
  engineEnabled: boolean;
  engineDepth: number;
  engineInReview: boolean;
  githubDefaultRepo: string;
  githubRememberToken: boolean;
  onboardingDone: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  theme: 'dark',
  fontScale: 1,
  motion: 'system',
  boardTheme: 'emeraude',
  pieceSet: 'cburnett',
  coordinates: true,
  showLegal: false,
  boardSize: 'normal',
  notation: 'fr',
  feedbackStyle: 'humorous',
  opponentDelayMs: 450,
  contextSpeedMs: 140,
  autoAdvanceMs: 900,
  slowMs: 12000,
  fastMs: 2500,
  retention: 0.9,
  newLimit: 10,
  askConfidence: false,
  errorPolicy: { retry: true, revealAfter: 0, stopLine: false, countAsFailure: true },
  autoplaySpeedMs: 900,
  engineEnabled: true,
  engineDepth: 18,
  engineInReview: false,
  githubDefaultRepo: (import.meta.env.VITE_DEFAULT_GITHUB_REPO as string | undefined) ?? '',
  githubRememberToken: false,
  onboardingDone: false,
};

const KEY = 'pat.settings.v1';

function load(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<Settings>;
    return { ...DEFAULT_SETTINGS, ...parsed, errorPolicy: { ...DEFAULT_SETTINGS.errorPolicy, ...(parsed.errorPolicy ?? {}) } };
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
    const next = { ...DEFAULT_SETTINGS, ...s };
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
  const sizes: Record<Settings['boardSize'], string> = { compact: '520px', normal: '640px', large: '760px', max: '980px' };
  root.style.setProperty('--board-max', sizes[s.boardSize]);
  const meta = document.querySelector('meta[name="theme-color"]');
  meta?.setAttribute('content', root.dataset.theme === 'light' ? '#f2f5f4' : '#0a0f14');
  configureScheduler({ retention: s.retention });
}

function onSchemeChange() {
  applySettings(useSettings.getState().settings);
}

export function animationsEnabled(s: Settings): boolean {
  if (s.motion === 'off') return false;
  if (s.motion === 'on') return true;
  return !(typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
}
