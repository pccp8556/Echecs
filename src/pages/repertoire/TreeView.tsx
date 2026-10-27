import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronRight, MessageSquare, MoreHorizontal, Shuffle, Play, Flag } from 'lucide-react';
import type { MergedForest, MergedNode } from '../../core/repertoire/merged';
import { mergedPath } from '../../core/repertoire/merged';
import { checkState, type ResolvedSelection } from '../../core/repertoire/selection';
import { LINE_MARKS, type LineMark } from '../../core/repertoire/types';
import { formatLine, formatSan, nagText, type NotationStyle } from '../../core/chess/notation';
import { sideToMove, type Color } from '../../core/chess/fen';
import { cardId, masteryOf, MASTERY_LABELS, type MasteryLevel, type ReviewCard } from '../../core/srs/srs';
import { Menu } from '../../ui/kit';

export interface TreeCtx {
  forest: MergedForest;
  res: ResolvedSelection;
  current: string;
  marks: Record<string, LineMark>;
  leaves: Map<string, number>;
  cards: Map<string, ReviewCard>;
  repId: string;
  color: Color;
  notation: NotationStyle;
  now: number;
  onNavigate: (key: string) => void;
  onToggle: (key: string, include: boolean) => void;
  onMark: (key: string, mark: LineMark | null) => void;
  onReview: (key: string) => void;
}

export function segmentFrom(node: MergedNode): MergedNode[] {
  const seg = [node];
  let n = node;
  while (n.children.length === 1) {
    n = n.children[0];
    seg.push(n);
  }
  return seg;
}

const ORDER: MasteryLevel[] = ['fragile', 'new', 'learning', 'solid', 'mastered'];

function segmentMastery(seg: MergedNode[], ctx: TreeCtx): MasteryLevel | null {
  let worst: MasteryLevel | null = null;
  for (const n of seg) {
    const parent = n.parentKey ? ctx.forest.byKey.get(n.parentKey) : undefined;
    if (!parent || sideToMove(parent.fen) !== ctx.color) continue;
    const lvl = masteryOf(ctx.cards.get(cardId(ctx.repId, parent.posKey)), ctx.now);
    if (!worst || ORDER.indexOf(lvl) < ORDER.indexOf(worst)) worst = lvl;
  }
  return worst;
}

function MoveText({ seg, ctx, parentFen }: { seg: MergedNode[]; ctx: TreeCtx; parentFen: string }) {
  let fen = parentFen;
  return (
    <span className="tree-moves">
      {seg.map((n, i) => {
        const turn = sideToMove(fen);
        const num = fen.split(' ')[5];
        const label = turn === 'w' ? `${num}.` : i === 0 ? `${num}...` : '';
        fen = n.fen;
        const trans = (ctx.forest.byPos.get(n.posKey)?.length ?? 0) > 1;
        return (
          <button
            key={n.key}
            type="button"
            className={`tree-move ${n.key === ctx.current ? 'is-current' : ''} ${ctx.res.selected.has(n.key) ? '' : 'is-off'}`}
            onClick={() => ctx.onNavigate(n.key)}
            title={trans ? 'Position également atteinte par un autre ordre de coups' : undefined}
          >
            {label}
            {formatSan(n.san, ctx.notation)}
            {nagText(n.nags) && <span className="nag">{nagText(n.nags)}</span>}
            {trans && <Shuffle className="tree-trans" aria-label="transposition" />}
          </button>
        );
      })}
    </span>
  );
}

const Row = memo(function Row({ head, ctx, depth, expanded, toggleExpand }: { head: MergedNode; ctx: TreeCtx; depth: number; expanded: Set<string>; toggleExpand: (k: string) => void }) {
  const seg = useMemo(() => segmentFrom(head), [head]);
  const tail = seg[seg.length - 1];
  const parent = head.parentKey ? ctx.forest.byKey.get(head.parentKey) : undefined;
  const state = checkState(head, ctx.res);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = state === 'partial';
  }, [state]);
  const isOpen = expanded.has(tail.key);
  const hasKids = tail.children.length > 1;
  const mark = ctx.marks[head.key];
  const mastery = segmentMastery(seg, ctx);
  const leaves = ctx.leaves.get(head.key) ?? 1;
  const hasComment = seg.some((n) => n.comments.length > 0);
  // Libellé accessible avec numéros de coups : « 6...g6 7.e5 ».
  const label = formatLine(
    seg.slice(0, 3).map((n) => n.san),
    parent?.fen ?? head.fen,
    ctx.notation,
  );
  return (
    <li className="tree-item" role="treeitem" aria-expanded={hasKids ? isOpen : undefined} aria-selected={state !== 'unchecked'}>
      <div className={`tree-row ${seg.some((n) => n.key === ctx.current) ? 'has-current' : ''}`} style={{ paddingLeft: 6 + depth * 18 }}>
        {hasKids ? (
          <button type="button" className="btn btn-ghost btn-icon btn-sm tree-toggle" onClick={() => toggleExpand(tail.key)} aria-label={isOpen ? 'Replier' : 'Déplier'}>
            {isOpen ? <ChevronDown /> : <ChevronRight />}
          </button>
        ) : (
          <span className="tree-toggle-spacer" />
        )}
        <input
          ref={ref}
          type="checkbox"
          className="checkbox"
          checked={state === 'checked'}
          onChange={() => ctx.onToggle(head.key, state !== 'checked')}
          aria-label={`${state === 'checked' ? 'Exclure' : 'Inclure'} la variante ${label}`}
        />
        <MoveText seg={seg} ctx={ctx} parentFen={parent?.fen ?? head.fen} />
        <span className="tree-meta">
          {mark && <span className={`badge mark-${mark}`}>{LINE_MARKS[mark].label}</span>}
          {hasComment && <MessageSquare className="tree-icon" aria-label="commentaire" />}
          {mastery && <span className={`mdot m-${mastery}`} title={`Maîtrise : ${MASTERY_LABELS[mastery]}`} aria-label={`Maîtrise : ${MASTERY_LABELS[mastery]}`} />}
          <span className="badge" title={`${leaves} ligne(s) sous ce coup`}>
            {leaves}
          </span>
          <Menu label="Actions sur la variante" trigger={(open) => <button type="button" className="btn btn-ghost btn-icon btn-sm" aria-label={`Actions pour ${label}`} onClick={open}><MoreHorizontal /></button>}>
            {(close) => (
              <>
                <button
                  onClick={() => {
                    close();
                    ctx.onReview(head.key);
                  }}
                >
                  <Play /> Réviser cette variante
                </button>
                <hr />
                <button
                  onClick={() => {
                    close();
                    ctx.onMark(head.key, mark === 'abandoned' ? null : 'abandoned');
                  }}
                  title={LINE_MARKS.abandoned.hint}
                >
                  <Flag /> {mark === 'abandoned' ? 'Réactiver la variante' : 'Abandonner la variante'}
                </button>
                {mark && mark !== 'abandoned' && (
                  <button
                    onClick={() => {
                      close();
                      ctx.onMark(head.key, null);
                    }}
                  >
                    Retirer la marque « {LINE_MARKS[mark].label} »
                  </button>
                )}
              </>
            )}
          </Menu>
        </span>
      </div>
      {hasKids && isOpen && (
        <ul role="group" className="tree-list">
          {tail.children.map((c) => (
            <Row key={c.key} head={c} ctx={ctx} depth={depth + 1} expanded={expanded} toggleExpand={toggleExpand} />
          ))}
        </ul>
      )}
    </li>
  );
});

export function TreeView({ ctx, root }: { ctx: TreeCtx; root: MergedNode }) {
  const [expanded, setExpanded] = useState<Set<string>>(() => {
    const s = new Set<string>();
    const walk = (n: MergedNode, level: number) => {
      const seg = segmentFrom(n);
      const tail = seg[seg.length - 1];
      if (level < 2) {
        s.add(tail.key);
        for (const c of tail.children) walk(c, level + 1);
      }
    };
    for (const c of root.children) walk(c, 0);
    return s;
  });
  // Déplie le chemin vers le nœud courant.
  useEffect(() => {
    const path = mergedPath(ctx.forest, ctx.current);
    setExpanded((prev) => {
      let changed = false;
      const next = new Set(prev);
      for (const n of path.slice(0, -1)) if (n.children.length > 1 && !next.has(n.key)) {
        next.add(n.key);
        changed = true;
      }
      return changed ? next : prev;
    });
  }, [ctx.current, ctx.forest]);
  const toggleExpand = (k: string) =>
    setExpanded((prev) => {
      const n = new Set(prev);
      if (n.has(k)) n.delete(k);
      else n.add(k);
      return n;
    });
  const expandAll = (open: boolean) => {
    if (!open) return setExpanded(new Set());
    const s = new Set<string>();
    for (const n of ctx.forest.byKey.values()) if (n.children.length > 1) s.add(n.key);
    setExpanded(s);
  };
  const rootState = checkState(root, ctx.res);
  const rootStartSegs = root.children;
  return (
    <div className="tree">
      <div className="row row-between tree-head">
        <label className="row small">
          <input
            type="checkbox"
            className="checkbox"
            checked={rootState === 'checked'}
            ref={(el) => {
              if (el) el.indeterminate = rootState === 'partial';
            }}
            onChange={() => ctx.onToggle(root.key, rootState !== 'checked')}
          />
          <span>
            <strong>{root.rootKey === 'start' ? 'Position initiale' : 'Position FEN'}</strong> <span className="faint">· {ctx.leaves.get(root.key) ?? 0} lignes</span>
          </span>
        </label>
        <div className="row" style={{ gap: 4 }}>
          <button className="btn btn-ghost btn-sm" onClick={() => expandAll(true)}>
            Tout déplier
          </button>
          <button className="btn btn-ghost btn-sm" onClick={() => expandAll(false)}>
            Replier
          </button>
        </div>
      </div>
      <ul className="tree-list" role="tree" aria-label="Arbre des variantes">
        {rootStartSegs.map((c) => (
          <Row key={c.key} head={c} ctx={ctx} depth={0} expanded={expanded} toggleExpand={toggleExpand} />
        ))}
      </ul>
    </div>
  );
}
