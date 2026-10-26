import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import {
  AlertTriangle,
  BarChart3,
  BookMarked,
  Download,
  FileText,
  GitBranch,
  History,
  List,
  ListTree,
  Network,
  Pencil,
  Play,
  RefreshCw,
  Save,
  Search,
  Star,
  Library as LibraryIcon,
  NotebookPen,
  Heart,
} from 'lucide-react';
import { useRepertoire, masterySummary, userPositionKeys } from '../state/derived';
import { useLibrary } from '../state/library';
import { useSettings } from '../state/settings';
import { useSelections } from '../state/selections';
import { leafCounts, mergedPath, type MergedNode } from '../core/repertoire/merged';
import { countSelection, fullSelection, onlySubtrees, resolveSelection, staleRules, toggleSubtree, type RepertoireSelection } from '../core/repertoire/selection';
import { repertoireColor, type LineMark } from '../core/repertoire/types';
import { exportRepertoirePgn, safeFileName } from '../core/repertoire/export';
import { gameLabelFromHeaders } from '../core/pgn/parse';
import { normalizeFen, positionKey, sideToMove } from '../core/chess/fen';
import { formatLine } from '../core/chess/notation';
import { defaultConfig } from '../core/review/presets';
import { cardId, masteryOf, MASTERY_LABELS, formatInterval, type ReviewCard } from '../core/srs/srs';
import { savePreset } from '../storage/repo';
import { newId } from '../core/repertoire/build';
import { ColorDot, EmptyState, Loading, MasteryBar, MasteryLegend, Modal, Tabs, downloadText, formatRelative, pct, promptDialog, toast } from '../ui/kit';
import { PageHeader, startSessionAndGo } from './common';
import { ExplorerBoard, type OffBook } from './repertoire/ExplorerBoard';
import { TreeView, type TreeCtx } from './repertoire/TreeView';
import { ChaptersView, CompareView, GraphView, HistoryView, LinesView } from './repertoire/Views';
import { IssuesList, ReportStatsGrid } from './ImportReport';
import { reloadFromSource } from './reloadSource';
import { sequenceNodes } from '../core/repertoire/search';
import { useReview } from '../state/review';

type View = 'tree' | 'lines' | 'graph' | 'chapters' | 'report' | 'history';

export default function RepertoirePage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { rep, games, derived, loading, notFound } = useRepertoire(id);
  const lib = useLibrary();
  const cards = useLibrary((s) => s.cards);
  const settings = useSettings((s) => s.settings);
  const selStore = useSelections();
  const [view, setView] = useState<View>('tree');
  const [currentKey, setCurrentKey] = useState<string | null>(null);
  const [flip, setFlip] = useState(false);
  const [offBook, setOffBook] = useState<OffBook | null>(null);
  const [rootIdx, setRootIdx] = useState(0);
  const [compare, setCompare] = useState<MergedNode | null>(null);
  const [search, setSearch] = useState('');
  const [now] = useState(() => Date.now());

  useEffect(() => {
    if (rep) lib.updateMeta(rep.id, { lastOpenedAt: Date.now() });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rep?.id]);

  const forest = derived?.forest;
  const roots = forest?.roots ?? [];
  const root = roots[Math.min(rootIdx, roots.length - 1)];
  const selection: RepertoireSelection = id ? selStore.get(id) : fullSelection('');
  const res = useMemo(() => (forest && rep ? resolveSelection(forest, selection, rep.marks) : undefined), [forest, selection, rep]);
  const leaves = useMemo(() => (forest ? leafCounts(forest) : new Map<string, number>()), [forest]);
  const color = rep ? repertoireColor(rep) : 'w';
  const labels = useMemo(() => new Map((games ?? []).map((g, i) => [g.id, gameLabelFromHeaders(g.headers, i)])), [games]);
  const gameLabel = useCallback((gid: string) => labels.get(gid) ?? 'Partie', [labels]);
  const current = (currentKey && forest?.byKey.get(currentKey)) || derived?.trunk || root;

  useEffect(() => {
    if (current && root && current.rootKey !== root.rootKey) {
      const idx = roots.findIndex((r) => r.rootKey === current.rootKey);
      if (idx >= 0) setRootIdx(idx);
    }
  }, [current, root, roots]);

  const navigateTo = useCallback((k: string) => {
    setOffBook(null);
    setCurrentKey(k);
  }, []);

  const mastery = useMemo(() => (rep && games && forest ? masterySummary(rep.id, userPositionKeys(rep, games, forest), cards, now) : undefined), [rep, games, forest, cards, now]);
  const counts = useMemo(() => (forest && res ? countSelection(forest, res, color) : null), [forest, res, color]);
  const stale = forest ? staleRules(forest, selection) : [];

  const searchResults = useMemo(() => {
    if (!forest || !search.trim()) return null;
    const q = search.trim();
    const fen = normalizeFen(q);
    if ('fen' in fen && q.split('/').length >= 8) {
      const nodes = forest.byPos.get(positionKey(fen.fen)) ?? [];
      return { kind: 'Position', nodes };
    }
    const seq = sequenceNodes(forest, q, settings.notation);
    if (seq.length) return { kind: 'Séquence', nodes: seq.slice(0, 30) };
    const s = q.toLowerCase();
    const nodes = [...forest.byKey.values()].filter((n) => n.comments.some((c) => c.text.toLowerCase().includes(s))).slice(0, 30);
    return { kind: 'Commentaire', nodes };
  }, [forest, search, settings.notation]);

  if (loading) return <Loading />;
  if (notFound || !rep)
    return (
      <div className="page">
        <EmptyState icon={<LibraryIcon />} title="Répertoire introuvable" action={<Link className="btn btn-primary" to="/bibliotheque">Retour à la bibliothèque</Link>}>
          Il a peut-être été supprimé (vérifie la corbeille).
        </EmptyState>
      </div>
    );
  if (!games || !forest || !res || !root || !current)
    return (
      <div className="page">
        <PageHeader eyebrow="Répertoire" title={rep.name} />
        <div className="notice notice-danger">
          <AlertTriangle />
          <div>Aucune partie lisible dans ce répertoire. Consulte le rapport d’import ou corrige le PGN dans l’éditeur.</div>
        </div>
        <Link className="btn" to={`/repertoire/${rep.id}/editer`}>
          <Pencil /> Ouvrir l’éditeur
        </Link>
      </div>
    );

  const setSelection = (s: RepertoireSelection) => selStore.set(s);
  const onToggle = (key: string, include: boolean) => setSelection(toggleSubtree(selection, key, include));
  const onMark = (key: string, mark: LineMark | null) => lib.setMark(rep.id, key, mark);
  const reviewKeys = (keys: string[]) =>
    startSessionAndGo({ ...defaultConfig('full', [onlySubtrees(rep.id, keys)]), onError: settings.errorPolicy, askConfidence: settings.askConfidence }, navigate);

  const ctx: TreeCtx = {
    forest,
    res,
    current: current.key,
    marks: rep.marks,
    leaves,
    cards,
    repId: rep.id,
    color,
    notation: settings.notation,
    now,
    onNavigate: navigateTo,
    onToggle,
    onMark,
    onReview: (k) => reviewKeys([k]),
    onCompare: (k) => setCompare(forest.byKey.get(k) ?? null),
  };

  const orientation = flip ? (color === 'w' ? 'b' : 'w') : color;
  const curTurn = sideToMove(current.fen);
  const curCard = cards.get(cardId(rep.id, current.posKey));
  const isUserPos = curTurn === color && current.children.length > 0 && !offBook;

  const exportPgn = (selectionOnly: boolean) => {
    const notes = new Map([...cards.values()].filter((c) => c.repertoireId === rep.id && c.note).map((c) => [c.posKey, c.note!]));
    const keep = selectionOnly ? res.relevant : undefined;
    downloadText(safeFileName(selectionOnly ? `${rep.name} - sélection` : rep.name), exportRepertoirePgn(rep, games, { annotations: true, notes, keep }));
    toast.success('PGN exporté');
  };

  const saveSelection = async () => {
    const name = await promptDialog({ title: 'Enregistrer la sélection', label: 'Nom de la session réutilisable', defaultValue: `${rep.name} — sélection` });
    if (!name) return;
    const t = Date.now();
    await savePreset({ id: newId(), name, config: { ...defaultConfig('smart', [selection]), presetName: name }, createdAt: t, updatedAt: t });
    toast.success('Sélection enregistrée', 'Retrouve-la dans « Réviser » parmi tes sessions enregistrées.');
  };

  return (
    <div className="page page-wide">
      <PageHeader
        eyebrow="Répertoire"
        title={
          <span className="row" style={{ gap: 12 }}>
            {rep.name}
            {rep.favorite && <Star className="text-gold" size={22} aria-label="Favori" />}
          </span>
        }
        actions={
          <>
            <button className="btn" onClick={() => lib.updateMeta(rep.id, { favorite: !rep.favorite })} aria-pressed={rep.favorite}>
              <Star /> {rep.favorite ? 'Favori' : 'Favori'}
            </button>
            <button
              className="btn"
              onClick={async () => {
                const u = await reloadFromSource(rep);
                if (u) await lib.loadGames(rep.id, true);
              }}
            >
              <RefreshCw /> Recharger
            </button>
            <button className="btn" onClick={() => exportPgn(false)}>
              <Download /> Exporter
            </button>
            <Link className="btn" to={`/repertoire/${rep.id}/editer`}>
              <Pencil /> Éditer
            </Link>
            <button className="btn btn-primary" onClick={() => navigate(`/session/nouvelle?rep=${rep.id}&sel=1`)}>
              <Play /> Réviser la sélection
            </button>
          </>
        }
      >
        <span className="row row-wrap" style={{ gap: 8 }}>
          <span className="badge">
            <ColorDot color={color} /> Je joue les {color === 'w' ? 'Blancs' : 'Noirs'}
            {rep.color === 'auto' ? ' (détecté)' : ''}
          </span>
          <span className="badge">{rep.stats.games} parties</span>
          <span className="badge">{rep.stats.lines} lignes</span>
          <span className="badge">{rep.stats.positions} positions</span>
          <span className="badge">{rep.stats.comments} commentaires</span>
          {rep.stats.errors > 0 && <span className="badge badge-danger">{rep.stats.errors} erreurs d’import</span>}
          {rep.source.kind === 'demo' && <span className="badge badge-violet">Démonstration</span>}
          {rep.modified && <span className="badge badge-info">modifié dans l’application</span>}
          <span className="badge">révisé {formatRelative(rep.lastReviewedAt)}</span>
        </span>
      </PageHeader>

      {mastery && (
        <div className="card mastery-card">
          <div className="row row-between row-wrap">
            <div className="stack-sm grow">
              <div className="row row-between">
                <strong>Maîtrise du répertoire</strong>
                <span className="small muted tabular">
                  {mastery.counts.mastered} maîtrisées · {mastery.counts.solid} solides · {mastery.counts.fragile} fragiles · {mastery.counts.new} nouvelles · {mastery.due} dues
                </span>
              </div>
              <MasteryBar counts={mastery.counts} total={mastery.total} />
              <MasteryLegend />
            </div>
            <Link to={`/statistiques?rep=${rep.id}`} className="btn btn-sm">
              <BarChart3 /> Statistiques
            </Link>
          </div>
        </div>
      )}

      <div className="explorer">
        <section className="explorer-left" aria-label="Échiquier">
          <ExplorerBoard forest={forest} current={current} onNavigate={navigateTo} orientation={orientation} onFlip={() => setFlip((f) => !f)} gameLabel={gameLabel} offBook={offBook} setOffBook={setOffBook} />
          {isUserPos && (
            <PositionCard cardIdStr={cardId(rep.id, current.posKey)} card={curCard} now={now} />
          )}
        </section>

        <section className="explorer-right card" aria-label="Variantes">
          <div className="selection-summary">
            <div>
              <strong className="tabular">{counts?.lines ?? 0}</strong> ligne{(counts?.lines ?? 0) > 1 ? 's' : ''} ·{' '}
              <strong className="tabular">{counts?.userPositions ?? 0}</strong> position{(counts?.userPositions ?? 0) > 1 ? 's' : ''} à jouer sélectionnées
              <span className="faint"> / {rep.stats.lines} lignes</span>
            </div>
            <div className="row row-wrap" style={{ gap: 6 }}>
              <button className="btn btn-sm btn-ghost" onClick={() => setSelection(fullSelection(rep.id))}>
                Tout
              </button>
              <button className="btn btn-sm btn-ghost" onClick={() => setSelection({ ...fullSelection(rep.id), defaultInclude: false })}>
                Rien
              </button>
              <button className="btn btn-sm" onClick={saveSelection}>
                <Save /> Enregistrer
              </button>
              <button className="btn btn-sm" onClick={() => exportPgn(true)}>
                <FileText /> PGN de la sélection
              </button>
            </div>
          </div>
          {stale.length > 0 && (
            <div className="notice notice-warning">
              <AlertTriangle />
              <div>
                {stale.length} élément{stale.length > 1 ? 's' : ''} de la sélection n’existe{stale.length > 1 ? 'nt' : ''} plus (PGN modifié).{' '}
                <button className="btn btn-sm" onClick={() => setSelection({ ...selection, rules: selection.rules.filter((r) => !stale.includes(r.key)) })}>
                  Nettoyer
                </button>
              </div>
            </div>
          )}
          <div className="input-with-icon">
            <Search />
            <input className="input" type="search" placeholder="Chercher : coups (e4 c5 Cf3), commentaire, ou FEN d’une position" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Chercher dans le répertoire" />
          </div>
          {searchResults && (
            <div className="search-results">
              <div className="small faint">
                {searchResults.kind} · {searchResults.nodes.length} résultat{searchResults.nodes.length > 1 ? 's' : ''}
              </div>
              {searchResults.nodes.map((n) => {
                const p = mergedPath(forest, n.key);
                return (
                  <button key={n.key} className="search-hit" onClick={() => navigateTo(n.key)}>
                    <span className="mono small">{formatLine(p.slice(1).map((x) => x.san), p[0].fen, settings.notation) || 'Position de départ'}</span>
                    {n.occurrences[0] && <span className="tiny faint">{gameLabel(n.occurrences[0].gameId)}</span>}
                  </button>
                );
              })}
            </div>
          )}
          <Tabs
            label="Vues du répertoire"
            value={view}
            onChange={setView}
            tabs={[
              { value: 'tree', label: 'Arbre', icon: <ListTree /> },
              { value: 'lines', label: 'Lignes', icon: <List />, count: rep.stats.lines },
              { value: 'graph', label: 'Graphe', icon: <Network /> },
              { value: 'chapters', label: 'Chapitres', icon: <BookMarked />, count: rep.stats.games },
              { value: 'report', label: 'Rapport', icon: <GitBranch /> },
              { value: 'history', label: 'Historique', icon: <History /> },
            ]}
          />
          {roots.length > 1 && (view === 'tree' || view === 'graph') && (
            <div className="row row-wrap small">
              <label htmlFor="root-pick" className="faint">
                Point de départ
              </label>
              <select id="root-pick" className="select" style={{ width: 'auto', minHeight: 34, maxWidth: '100%' }} value={rootIdx} onChange={(e) => setRootIdx(Number(e.target.value))}>
                {roots.map((r, i) => (
                  <option key={r.key} value={i}>
                    {r.rootKey === 'start' ? `Position initiale (${leaves.get(r.key) ?? 0} lignes)` : `Position FEN · ${[...new Set(r.occurrences.map((o) => gameLabel(o.gameId)))].join(', ')}`}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div className="view-body">
            {view === 'tree' && <TreeView ctx={ctx} root={root} />}
            {view === 'lines' && (
              <LinesView forest={forest} res={res} rep={rep} cards={cards} color={color} notation={settings.notation} marks={rep.marks} gameLabel={gameLabel} current={current.key} onNavigate={navigateTo} onToggle={onToggle} />
            )}
            {view === 'graph' && <GraphView forest={forest} root={root} res={res} current={current.key} notation={settings.notation} onNavigate={navigateTo} />}
            {view === 'chapters' && <ChaptersView rep={rep} games={games} selection={selection} onSelection={setSelection} onNavigate={navigateTo} gameLabel={gameLabel} />}
            {view === 'report' && (
              <div className="stack">
                <ReportStatsGrid s={rep.stats} />
                <div className="small faint">
                  Source : {rep.source.kind === 'github' ? `GitHub ${rep.source.github?.owner}/${rep.source.github?.repo} · ${rep.source.github?.path}` : rep.source.fileName ?? rep.source.kind} · importé{' '}
                  {formatRelative(rep.source.importedAt)}
                  {rep.source.fileLastModified ? ` · fichier modifié le ${new Date(rep.source.fileLastModified).toLocaleDateString('fr-FR')}` : ''}
                </div>
                <IssuesList issues={games.flatMap((g) => g.issues)} max={100} />
              </div>
            )}
            {view === 'history' && <HistoryView rep={rep} />}
          </div>
        </section>
      </div>

      {compare && (
        <Modal title="Comparer deux suites" onClose={() => setCompare(null)} wide>
          <p className="muted small">Position après {formatLine(mergedPath(forest, compare.key).slice(1).map((n) => n.san), mergedPath(forest, compare.key)[0].fen, settings.notation) || 'le départ'}.</p>
          <CompareView node={compare} notation={settings.notation} />
        </Modal>
      )}
    </div>
  );
}

function PositionCard({ cardIdStr, card, now }: { cardIdStr: string; card: ReviewCard | undefined; now: number }) {
  const update = useReview((s) => s.updateCard);
  const level = masteryOf(card, now);
  return (
    <div className="card card-flat position-card">
      <div className="row row-between">
        <strong>Cette position (à toi de jouer)</strong>
        <span className={`badge mlevel-${level}`}>{MASTERY_LABELS[level]}</span>
      </div>
      <div className="small muted">
        {card && card.attempts > 0
          ? `${card.successes}/${card.attempts} réussites (${pct(card.successes / card.attempts)}) · ${card.hints} indice(s) · prochaine révision ${card.fsrs.due > now ? `dans ${formatInterval(card.fsrs.due - now)}` : 'maintenant'}`
          : 'Pas encore révisée.'}
      </div>
      <div className="row row-wrap">
        <button className="btn btn-sm" aria-pressed={!!card?.favorite} onClick={() => update(cardIdStr, (c) => ({ ...c, favorite: !c.favorite }))}>
          <Heart /> {card?.favorite ? 'Favorite' : 'Mettre en favori'}
        </button>
        <button
          className="btn btn-sm"
          onClick={async () => {
            const note = await promptDialog({ title: 'Note personnelle', label: 'Note sur cette position', defaultValue: card?.note ?? '', message: 'Elle sera exportée en commentaire PGN « Note perso : … ».' });
            if (note != null) await update(cardIdStr, (c) => ({ ...c, note }));
          }}
        >
          <NotebookPen /> {card?.note ? 'Modifier la note' : 'Ajouter une note'}
        </button>
      </div>
      {card?.note && <blockquote className="small">{card.note}</blockquote>}
    </div>
  );
}
