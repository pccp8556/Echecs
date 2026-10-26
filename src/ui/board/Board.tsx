import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from 'react';
import { Chess } from 'chess.js';
import type { Shape, ShapeColor } from '../../core/pgn/types';
import { PIECE_NAMES_FR, PieceSvg, type PieceSetId } from './pieces';
import { boardTheme, SHAPE_COLORS } from './themes';

export interface BoardMove {
  from: string;
  to: string;
  promotion?: string;
}

export type SquareMark = 'correct' | 'wrong' | 'info';

export interface BoardProps {
  fen: string;
  orientation: 'w' | 'b';
  /** Les pièces peuvent être déplacées. */
  interactive?: boolean;
  /** Camp autorisé à jouer (par défaut : le trait). */
  movableColor?: 'w' | 'b' | 'both';
  onMove?: (m: BoardMove) => void;
  lastMove?: { from: string; to: string };
  shapes?: Shape[];
  hintSquare?: string;
  showLegal?: boolean;
  coordinates?: boolean;
  marks?: Record<string, SquareMark>;
  heat?: Map<string, number>;
  drawable?: boolean;
  theme?: string;
  pieceSet?: PieceSetId;
  animate?: boolean;
  label?: string;
  shake?: number;
  className?: string;
}

interface PieceOnBoard {
  key: string;
  square: string;
  color: 'w' | 'b';
  type: string;
}

const FILES = 'abcdefgh';

function squareXY(square: string, orientation: 'w' | 'b'): [number, number] {
  const f = FILES.indexOf(square[0]);
  const r = Number(square[1]) - 1;
  return orientation === 'w' ? [f, 7 - r] : [7 - f, r];
}

function squareFromXY(x: number, y: number, orientation: 'w' | 'b'): string | null {
  if (x < 0 || x > 7 || y < 0 || y > 7) return null;
  const f = orientation === 'w' ? x : 7 - x;
  const r = orientation === 'w' ? 7 - y : y;
  return FILES[f] + (r + 1);
}

function parsePieces(fen: string): Array<Omit<PieceOnBoard, 'key'>> {
  const out: Array<Omit<PieceOnBoard, 'key'>> = [];
  const rows = fen.split(' ')[0].split('/');
  rows.forEach((row, i) => {
    let f = 0;
    for (const ch of row) {
      if (/\d/.test(ch)) f += Number(ch);
      else {
        out.push({ square: FILES[f] + (8 - i), color: ch === ch.toUpperCase() ? 'w' : 'b', type: ch.toLowerCase() });
        f++;
      }
    }
  });
  return out;
}

let keySeq = 0;

/** Associe les pièces à celles de la position précédente pour animer les déplacements. */
function diffPieces(prev: PieceOnBoard[], next: Array<Omit<PieceOnBoard, 'key'>>): PieceOnBoard[] {
  const out: PieceOnBoard[] = [];
  const unmatchedPrev = [...prev];
  const unmatchedNext: Array<Omit<PieceOnBoard, 'key'>> = [];
  for (const n of next) {
    const i = unmatchedPrev.findIndex((p) => p.square === n.square && p.color === n.color && p.type === n.type);
    if (i >= 0) {
      out.push({ ...n, key: unmatchedPrev[i].key });
      unmatchedPrev.splice(i, 1);
    } else unmatchedNext.push(n);
  }
  for (const n of unmatchedNext) {
    let best = -1;
    let bestD = Infinity;
    unmatchedPrev.forEach((p, i) => {
      if (p.color !== n.color || p.type !== n.type) return;
      const [x1, y1] = squareXY(p.square, 'w');
      const [x2, y2] = squareXY(n.square, 'w');
      const d = Math.hypot(x1 - x2, y1 - y2);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    if (best >= 0) {
      out.push({ ...n, key: unmatchedPrev[best].key });
      unmatchedPrev.splice(best, 1);
    } else {
      // Promotion : on réutilise le pion qui a disparu pour animer la montée.
      const pawn = unmatchedPrev.findIndex((p) => p.color === n.color && p.type === 'p');
      if (pawn >= 0) {
        out.push({ ...n, key: unmatchedPrev[pawn].key });
        unmatchedPrev.splice(pawn, 1);
      } else out.push({ ...n, key: `p${++keySeq}` });
    }
  }
  return out;
}

function legalMap(fen: string): Map<string, Array<{ to: string; promotion?: string }>> {
  const map = new Map<string, Array<{ to: string; promotion?: string }>>();
  try {
    const chess = new Chess(fen);
    for (const m of chess.moves({ verbose: true })) {
      const list = map.get(m.from) ?? [];
      list.push({ to: m.to, promotion: m.promotion });
      map.set(m.from, list);
    }
  } catch {
    /* FEN illisible : aucun coup */
  }
  return map;
}

function checkSquare(fen: string): string | null {
  try {
    const chess = new Chess(fen);
    if (!chess.isCheck()) return null;
    const turn = chess.turn();
    for (const row of chess.board()) for (const p of row) if (p && p.type === 'k' && p.color === turn) return p.square;
  } catch {
    /* ignore */
  }
  return null;
}

export function Board(props: BoardProps) {
  const {
    fen,
    orientation,
    interactive = false,
    onMove,
    lastMove,
    shapes = [],
    hintSquare,
    showLegal = false,
    coordinates = true,
    marks,
    heat,
    drawable = true,
    theme = 'emeraude',
    pieceSet = 'cburnett',
    animate = true,
    label = 'Échiquier',
    shake,
    className,
  } = props;
  const ref = useRef<HTMLDivElement>(null);
  const prevPieces = useRef<PieceOnBoard[]>([]);
  const pieces = useMemo(() => {
    const next = diffPieces(prevPieces.current, parsePieces(fen));
    prevPieces.current = next;
    return next;
  }, [fen]);
  const legal = useMemo(() => legalMap(fen), [fen]);
  const check = useMemo(() => checkSquare(fen), [fen]);
  const turn = fen.split(' ')[1] === 'b' ? 'b' : 'w';
  const movable = props.movableColor ?? turn;
  const [selected, setSelected] = useState<string | null>(null);
  const [drag, setDrag] = useState<{ from: string; x: number; y: number; active: boolean; pointerId: number; startX: number; startY: number } | null>(null);
  const [promotion, setPromotion] = useState<{ from: string; to: string; color: 'w' | 'b' } | null>(null);
  const [drawn, setDrawn] = useState<Shape[]>([]);
  const drawStart = useRef<{ square: string; color: ShapeColor } | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [announce, setAnnounce] = useState('');
  const wasSelectedOnDown = useRef(false);

  useEffect(() => {
    setSelected(null);
    setPromotion(null);
    setDrawn([]);
  }, [fen]);

  // Petite secousse de l'échiquier après une erreur.
  useEffect(() => {
    const el = ref.current;
    if (!shake || !el) return;
    el.classList.remove('is-shaking');
    void el.offsetWidth;
    el.classList.add('is-shaking');
    const t = window.setTimeout(() => el.classList.remove('is-shaking'), 450);
    return () => window.clearTimeout(t);
  }, [shake]);

  const canMoveFrom = useCallback(
    (sq: string) => {
      if (!interactive) return false;
      const p = pieces.find((x) => x.square === sq);
      if (!p) return false;
      if (p.color !== turn) return false;
      return movable === 'both' || movable === p.color;
    },
    [interactive, pieces, turn, movable],
  );

  const dests = useMemo(() => (selected ? legal.get(selected) ?? [] : []), [selected, legal]);

  const squareAt = (clientX: number, clientY: number): string | null => {
    const el = ref.current;
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const x = Math.floor(((clientX - r.left) / r.width) * 8);
    const y = Math.floor(((clientY - r.top) / r.height) * 8);
    return squareFromXY(x, y, orientation);
  };

  const tryMove = (from: string, to: string) => {
    const options = (legal.get(from) ?? []).filter((m) => m.to === to);
    if (!options.length) return false;
    if (options.some((o) => o.promotion)) {
      const p = pieces.find((x) => x.square === from);
      setPromotion({ from, to, color: p?.color ?? 'w' });
      return true;
    }
    setSelected(null);
    onMove?.({ from, to });
    return true;
  };

  const describe = (sq: string) => {
    const p = pieces.find((x) => x.square === sq);
    return p ? `${PIECE_NAMES_FR[p.type]} ${p.color === 'w' ? 'blanc' : 'noir'} en ${sq}` : `case ${sq} vide`;
  };

  const activateSquare = (sq: string) => {
    if (selected && dests.some((d) => d.to === sq)) {
      tryMove(selected, sq);
      return;
    }
    if (canMoveFrom(sq)) {
      setSelected(sq === selected ? null : sq);
      setAnnounce(sq === selected ? 'Sélection annulée' : `${describe(sq)} sélectionné. ${(legal.get(sq) ?? []).length} coups possibles.`);
    } else {
      setSelected(null);
    }
  };

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    const sq = squareAt(e.clientX, e.clientY);
    if (!sq) return;
    if (e.button === 2) {
      if (!drawable) return;
      const color: ShapeColor = e.shiftKey ? 'R' : e.altKey ? 'B' : e.ctrlKey || e.metaKey ? 'Y' : 'G';
      drawStart.current = { square: sq, color };
      return;
    }
    if (e.button !== 0) return;
    setDrawn([]);
    if (promotion) return;
    if (selected && dests.some((d) => d.to === sq)) {
      tryMove(selected, sq);
      return;
    }
    if (canMoveFrom(sq)) {
      wasSelectedOnDown.current = selected === sq;
      setSelected(sq);
      (e.currentTarget as HTMLDivElement).setPointerCapture?.(e.pointerId);
      setDrag({ from: sq, x: e.clientX, y: e.clientY, startX: e.clientX, startY: e.clientY, active: false, pointerId: e.pointerId });
    } else setSelected(null);
  };

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!drag || e.pointerId !== drag.pointerId) return;
    const moved = Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY);
    const size = ref.current?.getBoundingClientRect().width ?? 400;
    setDrag({ ...drag, x: e.clientX, y: e.clientY, active: drag.active || moved > Math.max(4, size / 80) });
  };

  const onPointerUp = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button === 2 && drawStart.current) {
      const end = squareAt(e.clientX, e.clientY);
      const start = drawStart.current;
      drawStart.current = null;
      if (!end) return;
      const shape: Shape = end === start.square ? { color: start.color, from: end } : { color: start.color, from: start.square, to: end };
      setDrawn((prev) => {
        const same = prev.findIndex((s) => s.from === shape.from && s.to === shape.to);
        if (same >= 0) {
          const copy = [...prev];
          if (copy[same].color === shape.color) copy.splice(same, 1);
          else copy[same] = shape;
          return copy;
        }
        return [...prev, shape];
      });
      return;
    }
    if (!drag || e.pointerId !== drag.pointerId) return;
    const target = squareAt(e.clientX, e.clientY);
    const from = drag.from;
    const wasActive = drag.active;
    setDrag(null);
    if (wasActive) {
      if (target && target !== from && tryMove(from, target)) return;
      if (target !== from) setSelected(null);
      return;
    }
    // Simple clic sur une pièce déjà sélectionnée : désélection.
    if (wasSelectedOnDown.current && target === from) setSelected(null);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const keys = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter', ' ', 'Escape'];
    if (!keys.includes(e.key)) return;
    e.preventDefault();
    const cur = cursor ?? (orientation === 'w' ? 'e2' : 'e7');
    if (e.key === 'Escape') {
      setSelected(null);
      setPromotion(null);
      return;
    }
    if (e.key === 'Enter' || e.key === ' ') {
      if (interactive) activateSquare(cur);
      return;
    }
    let [x, y] = squareXY(cur, orientation);
    if (e.key === 'ArrowUp') y = Math.max(0, y - 1);
    if (e.key === 'ArrowDown') y = Math.min(7, y + 1);
    if (e.key === 'ArrowLeft') x = Math.max(0, x - 1);
    if (e.key === 'ArrowRight') x = Math.min(7, x + 1);
    const next = squareFromXY(x, y, orientation)!;
    setCursor(next);
    setAnnounce(describe(next));
  };

  const t = boardTheme(theme);
  const style = { '--sq-light': t.light, '--sq-dark': t.dark, '--coord-light': t.coordLight, '--coord-dark': t.coordDark } as CSSProperties;
  const allShapes = [...shapes, ...drawn];
  const maxHeat = heat ? Math.max(1, ...heat.values()) : 1;

  const pos = (sq: string): CSSProperties => {
    const [x, y] = squareXY(sq, orientation);
    return { transform: `translate(${x * 100}%, ${y * 100}%)` };
  };

  const dragged = drag?.active ? pieces.find((p) => p.square === drag.from) : undefined;
  const rect = ref.current?.getBoundingClientRect();

  return (
    <div className={`board-wrap ${className ?? ''}`}>
      <div
        ref={ref}
        className={`board ${interactive ? 'is-interactive' : ''} ${animate ? 'is-animated' : ''} ${drag?.active ? 'is-dragging' : ''}`}
        style={style}
        role="application"
        aria-label={`${label}. ${interactive ? 'Utilise les flèches pour te déplacer et Entrée pour choisir une pièce puis sa case d’arrivée.' : ''}`}
        tabIndex={0}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => setDrag(null)}
        onContextMenu={(e) => e.preventDefault()}
        onKeyDown={onKeyDown}
        onBlur={() => setCursor(null)}
      >
        <div className="board-squares" aria-hidden="true" />
        <div className="board-layer" aria-hidden="true">
          {lastMove && (
            <>
              <div className="hl hl-last" style={pos(lastMove.from)} />
              <div className="hl hl-last" style={pos(lastMove.to)} />
            </>
          )}
          {heat &&
            [...heat.entries()].map(([sq, n]) => (
              <div key={`h${sq}`} className="hl hl-heat" style={{ ...pos(sq), opacity: 0.15 + 0.75 * (n / maxHeat) }} />
            ))}
          {selected && <div className="hl hl-selected" style={pos(selected)} />}
          {check && <div className="hl hl-check" style={pos(check)} />}
          {hintSquare && <div className="hl hl-hint" style={pos(hintSquare)} />}
          {cursor && <div className="hl hl-cursor" style={pos(cursor)} />}
          {(showLegal || drag?.active) &&
            dests.map((d) => {
              const occupied = pieces.some((p) => p.square === d.to);
              return <div key={`d${d.to}`} className={`hl ${occupied ? 'hl-capture' : 'hl-dest'}`} style={pos(d.to)} />;
            })}
          {!showLegal &&
            !drag?.active &&
            selected &&
            dests.map((d) => <div key={`d2${d.to}`} className="hl hl-dest hl-dest-soft" style={pos(d.to)} />)}
        </div>
        {coordinates && (
          <div className="board-coords" aria-hidden="true">
            {Array.from({ length: 8 }, (_, i) => {
              const file = orientation === 'w' ? FILES[i] : FILES[7 - i];
              const rank = orientation === 'w' ? 8 - i : i + 1;
              return (
                <span key={i}>
                  <i className={`coord-file ${(i + 7) % 2 === 0 ? 'on-light' : 'on-dark'}`} style={{ left: `${i * 12.5}%` }}>
                    {file}
                  </i>
                  <i className={`coord-rank ${i % 2 === 0 ? 'on-light' : 'on-dark'}`} style={{ top: `${i * 12.5}%` }}>
                    {rank}
                  </i>
                </span>
              );
            })}
          </div>
        )}
        <div className="board-pieces">
          {pieces.map((p) => (
            <div
              key={p.key}
              className={`piece ${drag?.active && drag.from === p.square ? 'is-ghosted' : ''} ${canMoveFrom(p.square) ? 'is-movable' : ''}`}
              style={pos(p.square)}
              data-square={p.square}
              data-piece={p.color + p.type}
            >
              <PieceSvg set={pieceSet} piece={p.color + p.type} />
            </div>
          ))}
        </div>
        {marks &&
          Object.entries(marks).map(([sq, m]) => (
            <div key={`m${sq}`} className={`square-mark mark-${m}`} style={pos(sq)} aria-hidden="true">
              <span>{m === 'correct' ? '✓' : m === 'wrong' ? '✕' : 'i'}</span>
            </div>
          ))}
        {allShapes.length > 0 && <ShapesLayer shapes={allShapes} orientation={orientation} />}
        {dragged && rect && (
          <div
            className="piece piece-drag"
            style={{
              width: rect.width / 8,
              height: rect.width / 8,
              transform: `translate(${drag!.x - rect.left - rect.width / 16}px, ${drag!.y - rect.top - rect.width / 16}px) scale(1.12)`,
            }}
          >
            <PieceSvg set={pieceSet} piece={dragged.color + dragged.type} />
          </div>
        )}
        {promotion && (
          <div className="promotion" role="dialog" aria-label="Choisir la pièce de promotion">
            <div className="promotion-card">
              {(['q', 'r', 'b', 'n'] as const).map((p) => (
                <button
                  key={p}
                  type="button"
                  aria-label={PIECE_NAMES_FR[p]}
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={() => {
                    const pr = promotion;
                    setPromotion(null);
                    setSelected(null);
                    onMove?.({ from: pr.from, to: pr.to, promotion: p });
                  }}
                >
                  <PieceSvg set={pieceSet} piece={promotion.color + p} />
                </button>
              ))}
              <button type="button" className="promotion-cancel" onPointerDown={(e) => e.stopPropagation()} onClick={() => setPromotion(null)}>
                Annuler
              </button>
            </div>
          </div>
        )}
      </div>
      <div className="sr-only" aria-live="polite">
        {announce}
      </div>
    </div>
  );
}

function ShapesLayer({ shapes, orientation }: { shapes: Shape[]; orientation: 'w' | 'b' }) {
  const center = (sq: string) => {
    const [x, y] = squareXY(sq, orientation);
    return [x * 12.5 + 6.25, y * 12.5 + 6.25];
  };
  return (
    <svg className="board-shapes" viewBox="0 0 100 100" aria-hidden="true">
      <defs>
        {Object.entries(SHAPE_COLORS).map(([c, col]) => (
          <marker key={c} id={`ah-${c}`} viewBox="0 0 10 10" refX="5" refY="5" markerWidth="3.2" markerHeight="3.2" orient="auto-start-reverse">
            <path d="M0,0 L10,5 L0,10 z" fill={col} />
          </marker>
        ))}
      </defs>
      {shapes.map((s, i) => {
        const col = SHAPE_COLORS[s.color] ?? SHAPE_COLORS.G;
        if (!s.to || s.to === s.from) {
          const [cx, cy] = center(s.from);
          return <circle key={i} cx={cx} cy={cy} r="5.6" fill="none" stroke={col} strokeWidth="0.9" opacity="0.85" />;
        }
        const [x1, y1] = center(s.from);
        const [x2, y2] = center(s.to);
        const len = Math.hypot(x2 - x1, y2 - y1);
        const shorten = 3.6;
        const ex = x2 - ((x2 - x1) / len) * shorten;
        const ey = y2 - ((y2 - y1) / len) * shorten;
        return <line key={i} x1={x1} y1={y1} x2={ex} y2={ey} stroke={col} strokeWidth="2.1" strokeLinecap="round" markerEnd={`url(#ah-${s.color})`} opacity="0.8" />;
      })}
    </svg>
  );
}
