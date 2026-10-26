import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronFirst, ChevronLast, ChevronLeft, ChevronRight, Copy, FlipVertical2, Maximize2, Minimize2, Pause, Play, MapPin, CornerUpLeft } from 'lucide-react';
import { Board, type BoardMove } from '../../ui/board/Board';
import { useSettings, animationsEnabled } from '../../state/settings';
import { mergedPath, type MergedForest, type MergedNode } from '../../core/repertoire/merged';
import { formatLine, formatSan, nagText, type NotationStyle } from '../../core/chess/notation';
import { positionKey, sideToMove } from '../../core/chess/fen';
import { resolveMove } from '../../core/review/engine';
import { copyText } from '../../ui/kit';
import { EnginePanel } from '../../ui/EnginePanel';
import type { Shape } from '../../core/pgn/types';

export interface OffBook {
  /** Nœud du répertoire d'où l'on est sorti. */
  fromKey: string;
  moves: Array<{ uci: string; san: string; fenBefore: string; fenAfter: string }>;
}

interface Props {
  forest: MergedForest;
  current: MergedNode;
  onNavigate: (key: string) => void;
  orientation: 'w' | 'b';
  onFlip: () => void;
  gameLabel: (id: string) => string;
  offBook: OffBook | null;
  setOffBook: (o: OffBook | null) => void;
}

export function useExplorerKeys(handlers: Record<string, () => void>, enabled = true) {
  const ref = useRef(handlers);
  ref.current = handlers;
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest('input, textarea, select, [contenteditable="true"]')) return;
      if (t.closest('.board') && ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter', ' '].includes(e.key)) return;
      const h = ref.current[e.key];
      if (h) {
        e.preventDefault();
        h();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [enabled]);
}

export function ExplorerBoard({ forest, current, onNavigate, orientation, onFlip, gameLabel, offBook, setOffBook }: Props) {
  const s = useSettings((x) => x.settings);
  const [playing, setPlaying] = useState(false);
  const [full, setFull] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const path = useMemo(() => mergedPath(forest, current.key), [forest, current.key]);
  const root = path[0];
  const offFen = offBook?.moves.length ? offBook.moves[offBook.moves.length - 1].fenAfter : null;
  const fen = offFen ?? current.fen;
  const lastMove = offBook?.moves.length
    ? { from: offBook.moves[offBook.moves.length - 1].uci.slice(0, 2), to: offBook.moves[offBook.moves.length - 1].uci.slice(2, 4) }
    : current.uci
      ? { from: current.uci.slice(0, 2), to: current.uci.slice(2, 4) }
      : undefined;

  const next = useCallback(() => {
    if (offBook) return;
    const c = current.children[0];
    if (c) onNavigate(c.key);
    else setPlaying(false);
  }, [current, onNavigate, offBook]);
  const prev = useCallback(() => {
    if (offBook) {
      if (offBook.moves.length > 1) setOffBook({ ...offBook, moves: offBook.moves.slice(0, -1) });
      else setOffBook(null);
      return;
    }
    if (current.parentKey) onNavigate(current.parentKey);
  }, [current, onNavigate, offBook, setOffBook]);
  const first = useCallback(() => {
    setOffBook(null);
    onNavigate(root.key);
  }, [onNavigate, root, setOffBook]);
  const last = useCallback(() => {
    setOffBook(null);
    let n = current;
    while (n.children[0]) n = n.children[0];
    onNavigate(n.key);
  }, [current, onNavigate, setOffBook]);
  const sibling = (delta: number) => {
    if (!current.parentKey) return;
    const parent = forest.byKey.get(current.parentKey);
    if (!parent) return;
    const i = parent.children.findIndex((c) => c.key === current.key);
    const t = parent.children[i + delta];
    if (t) onNavigate(t.key);
  };

  useEffect(() => {
    if (!playing) return;
    const t = window.setTimeout(next, s.autoplaySpeedMs);
    return () => window.clearTimeout(t);
  }, [playing, next, s.autoplaySpeedMs, current.key]);

  useExplorerKeys({
    ArrowRight: next,
    ArrowLeft: prev,
    ArrowUp: () => sibling(-1),
    ArrowDown: () => sibling(1),
    Home: first,
    End: last,
    f: onFlip,
    ' ': () => setPlaying((p) => !p),
  });

  useEffect(() => {
    const onFs = () => setFull(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onFs);
    return () => document.removeEventListener('fullscreenchange', onFs);
  }, []);

  const toggleFullscreen = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await wrapRef.current?.requestFullscreen();
    } catch {
      setFull((f) => !f);
    }
  };

  const onMove = (m: BoardMove) => {
    const mv = resolveMove(fen, m);
    if (!mv) return;
    if (!offBook) {
      const child = current.children.find((c) => c.uci === mv.uci);
      if (child) {
        onNavigate(child.key);
        return;
      }
    }
    // Hors répertoire : la position est explorée librement (sans rien modifier).
    const moves = [...(offBook?.moves ?? []), { uci: mv.uci, san: mv.san, fenBefore: fen, fenAfter: mv.fenAfter }];
    setOffBook({ fromKey: offBook?.fromKey ?? current.key, moves });
  };

  const transposition = offFen ? forest.byPos.get(positionKey(offFen)) : undefined;
  const shapes: Shape[] = offBook ? [] : current.shapes;
  const sans = path.slice(1).map((n) => n.san);
  const lineText = formatLine(sans, root.fen, s.notation);
  const comments = offBook ? [] : current.comments;
  const transposed = !offBook && (forest.byPos.get(current.posKey)?.length ?? 0) > 1;

  return (
    <div className={`explorer-board ${full ? 'is-full' : ''}`} ref={wrapRef}>
      <div className="board-frame">
        <Board
          fen={fen}
          orientation={orientation}
          interactive
          movableColor="both"
          onMove={onMove}
          lastMove={lastMove}
          shapes={shapes}
          coordinates={s.coordinates}
          showLegal={s.showLegal}
          theme={s.boardTheme}
          pieceSet={s.pieceSet}
          animate={animationsEnabled(s)}
          label="Échiquier d’exploration"
        />
      </div>
      <div className="board-controls" role="toolbar" aria-label="Navigation dans la ligne">
        <button className="btn btn-icon" onClick={first} data-tip="Début (Origine)" aria-label="Retour au début">
          <ChevronFirst />
        </button>
        <button className="btn btn-icon" onClick={prev} data-tip="Coup précédent (←)" aria-label="Coup précédent">
          <ChevronLeft />
        </button>
        <button className="btn btn-icon" onClick={() => setPlaying((p) => !p)} data-tip="Lecture automatique (Espace)" aria-label={playing ? 'Pause' : 'Lecture automatique'} aria-pressed={playing}>
          {playing ? <Pause /> : <Play />}
        </button>
        <button className="btn btn-icon" onClick={next} data-tip="Coup suivant (→)" aria-label="Coup suivant">
          <ChevronRight />
        </button>
        <button className="btn btn-icon" onClick={last} data-tip="Fin de la ligne (Fin)" aria-label="Fin de la ligne principale">
          <ChevronLast />
        </button>
        <span className="toolbar-sep" />
        <button className="btn btn-icon" onClick={onFlip} data-tip="Retourner (F)" aria-label="Retourner l’échiquier">
          <FlipVertical2 />
        </button>
        <button className="btn btn-icon" onClick={toggleFullscreen} data-tip="Plein écran" aria-label={full ? 'Quitter le plein écran' : 'Plein écran'}>
          {full ? <Minimize2 /> : <Maximize2 />}
        </button>
      </div>
      <label className="speed small muted">
        Vitesse de lecture
        <input
          type="range"
          className="range"
          min={250}
          max={2500}
          step={50}
          value={2750 - s.autoplaySpeedMs}
          onChange={(e) => useSettings.getState().set({ autoplaySpeedMs: 2750 - Number(e.target.value) })}
          aria-label="Vitesse de lecture automatique"
        />
      </label>

      {offBook && (
        <div className="notice notice-warning">
          <MapPin />
          <div className="grow">
            <strong>Hors répertoire.</strong> {formatLine(offBook.moves.map((m) => m.san), offBook.moves[0].fenBefore, s.notation)} — position libre, rien n’est modifié.
            {transposition && transposition.length > 0 && (
              <div style={{ marginTop: 6 }}>
                Cette position existe dans ton répertoire (transposition).{' '}
                <button
                  className="btn btn-sm"
                  onClick={() => {
                    setOffBook(null);
                    onNavigate(transposition[0].key);
                  }}
                >
                  Y aller
                </button>
              </div>
            )}
          </div>
          <button className="btn btn-sm" onClick={() => setOffBook(null)}>
            <CornerUpLeft /> Revenir
          </button>
        </div>
      )}

      <div className="current-line">
        <div className="row row-between">
          <span className="small faint">Ligne actuelle</span>
          <div className="row" style={{ gap: 4 }}>
            <button className="btn btn-ghost btn-sm" onClick={() => copyText(lineText || '(position de départ)', 'Coups copiés')} aria-label="Copier la séquence de coups">
              <Copy /> Coups
            </button>
            <button className="btn btn-ghost btn-sm" onClick={() => copyText(fen, 'FEN copiée')} aria-label="Copier la FEN">
              <Copy /> FEN
            </button>
          </div>
        </div>
        <div className="line-moves">
          {path.length === 1 && <span className="faint">Position de départ{root.rootKey !== 'start' ? ' (FEN personnalisée)' : ''}</span>}
          {path.slice(1).map((n, i) => {
            const before = path[i].fen;
            const turn = sideToMove(before);
            const num = before.split(' ')[5];
            return (
              <button key={n.key} className={`move-chip ${n.key === current.key && !offBook ? 'is-current' : ''}`} onClick={() => onNavigate(n.key)}>
                {turn === 'w' ? `${num}.` : i === 0 ? `${num}...` : ''}
                {formatSan(n.san, s.notation)}
                {nagText(n.nags) && <span className="nag">{nagText(n.nags)}</span>}
              </button>
            );
          })}
        </div>
        <div className="fen mono tiny faint" title="FEN de la position">
          {fen}
        </div>
        {transposed && <div className="small text-accent">Transposition : cette position est atteinte par {forest.byPos.get(current.posKey)!.length} ordres de coups dans ton répertoire.</div>}
      </div>

      {comments.length > 0 && (
        <div className="comments">
          {comments.map((c, i) => (
            <blockquote key={i}>
              <p>{c.text}</p>
              <cite>{gameLabel(c.gameId)}</cite>
            </blockquote>
          ))}
        </div>
      )}

      {!offBook && current.children.length > 0 && (
        <div className="next-moves">
          <span className="small faint">Suites prévues</span>
          <div className="row row-wrap">
            {current.children.map((c) => (
              <button key={c.key} className="btn btn-sm" onClick={() => onNavigate(c.key)}>
                {formatLine([c.san], current.fen, s.notation)}
                {nagText(c.nags) && <span className="nag">{nagText(c.nags)}</span>}
                <span className="faint tiny">{c.occurrences.length > 1 ? `×${c.occurrences.length}` : ''}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {s.engineEnabled && (
        <div className="card card-flat">
          <EnginePanel fen={fen} repertoireMoves={offBook ? [] : current.children.map((c) => ({ uci: c.uci, san: c.san }))} notation={s.notation as NotationStyle} depth={s.engineDepth} />
        </div>
      )}
    </div>
  );
}
