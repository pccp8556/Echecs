import { useEffect, useMemo, useState } from 'react';
import { Download, History, Pencil, RotateCcw, Search, Eye } from 'lucide-react';
import { Link } from 'react-router';
import type { MergedForest } from '../../core/repertoire/merged';
import { rootKeyOf, rootNodeKey } from '../../core/repertoire/merged';
import { enumerateLines, lineText } from '../../core/repertoire/lines';
import { fullSelection, type RepertoireSelection, type ResolvedSelection, resolveSelection } from '../../core/repertoire/selection';
import { header, type GameRecord, type LineMark, type Repertoire } from '../../core/repertoire/types';
import { LINE_MARKS } from '../../core/repertoire/types';
import { formatLine, type NotationStyle } from '../../core/chess/notation';
import type { Color } from '../../core/chess/fen';
import { lineMastery } from '../../state/derived';
import { MASTERY_LABELS, type ReviewCard } from '../../core/srs/srs';
import { listRevisions } from '../../storage/repo';
import type { Revision } from '../../storage/db';
import { EmptyState, confirmDialog, downloadText, formatRelative, toast } from '../../ui/kit';
import { exportRepertoirePgn, safeFileName } from '../../core/repertoire/export';
import { useLibrary } from '../../state/library';

/* ---------------- Vue liste des lignes ---------------- */

export function LinesView({
  forest,
  res,
  rep,
  cards,
  color,
  notation,
  marks,
  gameLabel,
  current,
  onNavigate,
  onToggle,
}: {
  forest: MergedForest;
  res: ResolvedSelection;
  rep: Repertoire;
  cards: Map<string, ReviewCard>;
  color: Color;
  notation: NotationStyle;
  marks: Record<string, LineMark>;
  gameLabel: (id: string) => string;
  current: string;
  onNavigate: (k: string) => void;
  onToggle: (k: string, include: boolean) => void;
}) {
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<'tree' | 'weak' | 'long'>('tree');
  const [now] = useState(() => Date.now());
  const all = useMemo(() => enumerateLines(forest, resolveSelection(forest, fullSelection(rep.id), {}), rep.id), [forest, rep.id]);
  const rows = useMemo(() => {
    return all.map((l, i) => {
      // Point de divergence : premier nœud après la dernière bifurcation.
      let fork = l.steps.length - 1;
      while (fork > 0) {
        const parent = forest.byKey.get(l.steps[fork - 1].nodeKey);
        if (parent && parent.children.length > 1) break;
        fork--;
      }
      const head = l.steps[fork]?.nodeKey ?? l.key;
      const m = lineMastery(l, color, cards, now);
      const markKey = l.steps.map((s) => s.nodeKey).find((k) => marks[k]);
      return { l, i, head, fork, m, mark: markKey ? marks[markKey] : undefined, label: gameLabel(l.gameIds[0]) };
    });
  }, [all, forest, color, cards, now, marks, gameLabel]);
  const shown = rows
    .filter((r) => !q || r.label.toLowerCase().includes(q.toLowerCase()) || lineText(r.l, notation).toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => (sort === 'weak' ? a.m.score - b.m.score : sort === 'long' ? b.l.steps.length - a.l.steps.length : a.i - b.i));
  return (
    <div className="stack">
      <div className="row row-wrap">
        <div className="input-with-icon grow">
          <Search />
          <input className="input" placeholder="Filtrer les lignes (chapitre ou coups)…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Filtrer les lignes" />
        </div>
        <select className="select" style={{ width: 'auto' }} value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} aria-label="Trier les lignes">
          <option value="tree">Ordre du répertoire</option>
          <option value="weak">Moins maîtrisées d’abord</option>
          <option value="long">Plus longues d’abord</option>
        </select>
      </div>
      <ul className="lines-list">
        {shown.map(({ l, head, fork, m, mark, label }) => {
          const checked = res.selected.has(l.key);
          return (
            <li key={l.key} className={l.key === current ? 'is-current' : ''}>
              <input type="checkbox" className="checkbox" checked={checked} onChange={() => onToggle(head, !checked)} aria-label={`${checked ? 'Exclure' : 'Inclure'} la ligne ${label}`} />
              <button className="line-body" onClick={() => onNavigate(l.key)}>
                <span className="line-chapter truncate">{label}</span>
                <span className="mono small line-text">
                  {fork > 0 && <span className="faint">… </span>}
                  {formatLine(
                    l.steps.slice(Math.max(0, fork - 1)).map((s) => s.san),
                    l.steps[Math.max(0, fork - 1)].fenBefore,
                    notation,
                  )}
                </span>
              </button>
              {mark && <span className={`badge mark-${mark}`}>{LINE_MARKS[mark].label}</span>}
              <span className={`mdot m-${m.level}`} title={MASTERY_LABELS[m.level]} aria-label={`Maîtrise : ${MASTERY_LABELS[m.level]}`} />
              <span className="small faint tabular">{l.steps.length} coups</span>
            </li>
          );
        })}
      </ul>
      {!shown.length && <p className="muted">Aucune ligne ne correspond.</p>}
    </div>
  );
}

export function ChaptersView({
  rep,
  games,
  selection,
  onSelection,
  onNavigate,
  gameLabel,
}: {
  rep: Repertoire;
  games: GameRecord[];
  selection: RepertoireSelection;
  onSelection: (s: RepertoireSelection) => void;
  onNavigate: (k: string) => void;
  gameLabel: (id: string) => string;
}) {
  const lib = useLibrary();
  const ordered = rep.gameOrder.map((id) => games.find((g) => g.id === id)).filter((g): g is GameRecord => !!g);
  const selectedGames = selection.games === 'all' ? new Set(games.map((g) => g.id)) : new Set(selection.games);
  const toggle = (id: string, on: boolean) => {
    const n = new Set(selectedGames);
    if (on) n.add(id);
    else n.delete(id);
    onSelection({ ...selection, games: n.size === games.length ? 'all' : [...n] });
  };
  return (
    <div className="stack">
      <div className="row row-wrap small">
        <button className="btn btn-sm" onClick={() => onSelection({ ...selection, games: 'all' })}>
          Toutes les parties
        </button>
        <button className="btn btn-sm btn-ghost" onClick={() => onSelection({ ...selection, games: [] })}>
          Aucune
        </button>
        <span className="faint">
          {selectedGames.size} / {games.length} sélectionnées
        </span>
      </div>
      <ul className="list">
        {ordered.map((g) => {
          const errors = g.issues.filter((i) => i.severity === 'error').length;
          const eco = header(g.headers, 'ECO');
          const opening = header(g.headers, 'Opening');
          return (
            <li key={g.id}>
              <input type="checkbox" className="checkbox" checked={selectedGames.has(g.id)} onChange={(e) => toggle(g.id, e.target.checked)} aria-label={`Inclure ${gameLabel(g.id)}`} />
              <div className="grow">
                <div className="truncate" style={{ fontWeight: 650 }}>
                  {gameLabel(g.id)}
                </div>
                <div className="small faint truncate">
                  {[eco, opening, header(g.headers, 'Annotator')].filter(Boolean).join(' · ') || '—'}
                  {g.root.fen && rootKeyOf(g.root.fen) !== 'start' ? ' · position FEN' : ''}
                </div>
              </div>
              {g.fatal && <span className="badge badge-danger">illisible</span>}
              {!g.fatal && errors > 0 && <span className="badge badge-danger">{errors} erreur{errors > 1 ? 's' : ''}</span>}
              {g.modified && <span className="badge badge-info">modifiée</span>}
              <select
                className="select"
                style={{ width: 'auto', minHeight: 32 }}
                value={g.color ?? ''}
                aria-label={`Camp joué pour ${gameLabel(g.id)}`}
                onChange={async (e) => {
                  const color = (e.target.value || undefined) as Color | undefined;
                  const updated = games.map((x) => (x.id === g.id ? { ...x, color } : x));
                  await lib.saveContent(rep, updated, 'Camp joué modifié pour une partie');
                }}
              >
                <option value="">Camp du répertoire</option>
                <option value="w">Blancs</option>
                <option value="b">Noirs</option>
              </select>
              {!g.fatal && (
                <button className="btn btn-ghost btn-icon btn-sm" aria-label="Afficher sur l’échiquier" onClick={() => onNavigate(rootNodeKey(rootKeyOf(g.root.fen)) + (g.root.children[0] && !g.root.children[0].invalid ? g.root.children[0].uci : ''))}>
                  <Eye />
                </button>
              )}
              <Link className="btn btn-ghost btn-icon btn-sm" to={`/repertoire/${rep.id}/editer?partie=${g.id}`} aria-label={`Éditer ${gameLabel(g.id)}`}>
                <Pencil />
              </Link>
            </li>
          );
        })}
      </ul>
      {!ordered.length && <EmptyState icon={<Pencil />} title="Aucune partie" />}
    </div>
  );
}

/* ---------------- Historique des versions ---------------- */

export function HistoryView({ rep }: { rep: Repertoire }) {
  const lib = useLibrary();
  const [revs, setRevs] = useState<Revision[] | null>(null);
  useEffect(() => {
    listRevisions(rep.id).then(setRevs);
  }, [rep.id, rep.updatedAt]);
  if (!revs) return <div className="skeleton" style={{ height: 120 }} />;
  if (!revs.length)
    return (
      <EmptyState icon={<History />} title="Aucune version antérieure">
        Chaque enregistrement depuis l’éditeur, rechargement ou restauration conserve ici l’état précédent (25 dernières versions).
      </EmptyState>
    );
  return (
    <ul className="list">
      {revs.map((r) => (
        <li key={r.id}>
          <div className="grow">
            <div style={{ fontWeight: 650 }}>{new Date(r.createdAt).toLocaleString('fr-FR')}</div>
            <div className="small faint">
              {r.reason} · {r.games.length} parties · {formatRelative(r.createdAt)}
            </div>
          </div>
          <button
            className="btn btn-sm btn-ghost"
            onClick={() => downloadText(safeFileName(`${rep.name}-version-${new Date(r.createdAt).toISOString().slice(0, 16)}`), exportRepertoirePgn({ ...rep, marks: r.marks as Record<string, LineMark> }, r.games, { annotations: false }))}
          >
            <Download /> PGN
          </button>
          <button
            className="btn btn-sm"
            onClick={async () => {
              if (!(await confirmDialog({ title: 'Restaurer cette version', message: 'Le contenu actuel sera remplacé par cette version. L’état actuel sera lui-même conservé dans l’historique.', confirmLabel: 'Restaurer' }))) return;
              const { restoreRevision } = await import('../../storage/repo');
              await restoreRevision(r.id);
              await lib.refresh();
              await lib.loadGames(rep.id, true);
              toast.success('Version restaurée');
            }}
          >
            <RotateCcw /> Restaurer
          </button>
        </li>
      ))}
    </ul>
  );
}

/* ---------------- Comparaison de deux suites ---------------- */
