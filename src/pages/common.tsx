import { useEffect, useState, type ReactNode } from 'react';
import type { NavigateFunction } from 'react-router';
import { Board } from '../ui/board/Board';
import { useSettings } from '../state/settings';
import { useReview } from '../state/review';
import { toast } from '../ui/kit';
import type { ReviewMode, SessionConfig } from '../core/review/types';
import type { RepertoireSelection } from '../core/repertoire/selection';
import { defaultConfig } from '../core/review/presets';
import { getLogs } from '../storage/repo';
import type { StoredLog } from '../storage/db';

export function PageHeader({ eyebrow, title, children, actions }: { eyebrow?: string; title: ReactNode; children?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="page-header">
      <div className="grow">
        {eyebrow && <div className="eyebrow">{eyebrow}</div>}
        <h1>{title}</h1>
        {children && <p>{children}</p>}
      </div>
      {actions && <div className="btn-group">{actions}</div>}
    </header>
  );
}

export function MiniBoard({ fen, orientation, lastMove, label }: { fen: string; orientation: 'w' | 'b'; lastMove?: { from: string; to: string }; label?: string }) {
  const s = useSettings((x) => x.settings);
  return (
    <div className="mini-board">
      <Board fen={fen} orientation={orientation} coordinates={false} theme={s.boardTheme} pieceSet={s.pieceSet} animate={false} lastMove={lastMove} drawable={false} label={label ?? 'Aperçu de la position'} />
    </div>
  );
}

/** Configuration d'une session avec les préférences de l'utilisateur. */
export function sessionConfig(mode: ReviewMode, selections: RepertoireSelection[], extra: Partial<SessionConfig> = {}): SessionConfig {
  const { newLimit, askConfidence, secondChance } = useSettings.getState().settings;
  return { ...defaultConfig(mode, selections, { newLimit, askConfidence, secondChance }), ...extra };
}

export async function startSessionAndGo(config: SessionConfig, navigate: NavigateFunction) {
  try {
    const id = await useReview.getState().start(config);
    const s = useReview.getState().session;
    if (s && s.phase === 'finished' && s.queue.length === 0) {
      toast.info('Rien à réviser', 'Aucune position ne correspond (rien n’est dû, ou la sélection est vide). Essaie « Toute la sélection » ou élargis la sélection.');
      return;
    }
    navigate(`/session/${id}`);
  } catch (e) {
    toast.error('Impossible de démarrer la session', e instanceof Error ? e.message : String(e));
  }
}

/** Journal des réponses depuis une date (rechargé à chaque montage). */
export function useLogs(since?: number) {
  const [logs, setLogs] = useState<StoredLog[] | null>(null);
  useEffect(() => {
    let alive = true;
    getLogs(since != null ? { since } : {})
      .then((l) => alive && setLogs(l))
      .catch(() => alive && setLogs([]));
    return () => {
      alive = false;
    };
  }, [since]);
  return logs;
}

export function greeting(now = new Date()): string {
  const h = now.getHours();
  if (h < 5) return 'Bonne nuit';
  if (h < 18) return 'Bonjour';
  return 'Bonsoir';
}
