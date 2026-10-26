import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useBlocker, useNavigate, useParams, useSearchParams } from 'react-router';
import {
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Code2,
  Copy,
  CornerLeftUp,
  Eye,
  FilePlus2,
  Plus,
  Redo2,
  Save,
  Trash2,
  Undo2,
  Wand2,
  XCircle,
  AlertTriangle,
} from 'lucide-react';
import { useRepertoire } from '../state/derived';
import { useLibrary } from '../state/library';
import { useSettings, animationsEnabled } from '../state/settings';
import { Board, type BoardMove } from '../ui/board/Board';
import type { GameRecord } from '../core/repertoire/types';
import type { GameRoot, MoveNode, ParsedFile } from '../core/pgn/types';
import { addMove, countTree, deleteNode, findNode, findPath, isMoveNode, maxNodeId, moveVariation, promoteNode, subtreeSize, updateNode, type TreeNode } from '../core/pgn/tree';
import { exportGame } from '../core/pgn/export';
import { gameLabelFromHeaders, parsePgn } from '../core/pgn/parse';
import { formatSan, moveNumberFromFenBefore, NAG_LABELS, NAG_SYMBOLS, nagText } from '../core/chess/notation';
import { START_FEN, normalizeFen, sideToMove } from '../core/chess/fen';
import { gameRecordFromParsed, newId } from '../core/repertoire/build';
import { EmptyState, Loading, Segmented, confirmDialog, toast } from '../ui/kit';
import { PageHeader } from './common';
import { IssuesList, ReportStatsGrid } from './ImportReport';

const MOVE_NAGS = [1, 2, 3, 4, 5, 6, 7];
const POS_NAGS = [10, 13, 14, 15, 16, 17, 18, 19, 44, 36, 40, 132, 146];

function countsOf(g: GameRecord) {
  const c = countTree(g.root);
  return { moves: c.moves, comments: c.comments, variations: c.variations, invalid: c.invalid };
}

export default function EditorPage() {
  const { id } = useParams();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const { rep, games: stored, loading, notFound } = useRepertoire(id);
  const lib = useLibrary();
  const settings = useSettings((s) => s.settings);
  const [games, setGames] = useState<GameRecord[] | null>(null);
  const [past, setPast] = useState<GameRecord[][]>([]);
  const [future, setFuture] = useState<GameRecord[][]>([]);
  const [dirty, setDirty] = useState(false);
  const [mode, setMode] = useState<'visual' | 'text' | 'all'>('visual');
  const [nodeId, setNodeId] = useState(0);
  const [flip, setFlip] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (stored && !games) setGames(structuredClone(stored));
  }, [stored, games]);

  const ordered = useMemo(() => {
    if (!games || !rep) return [];
    const pos = new Map(rep.gameOrder.map((g, i) => [g, i]));
    return [...games].sort((a, b) => (pos.get(a.id) ?? 1e9) - (pos.get(b.id) ?? 1e9));
  }, [games, rep]);
  const gameId = params.get('partie') ?? ordered[0]?.id;
  const game = games?.find((g) => g.id === gameId) ?? ordered[0];

  const blocker = useBlocker(({ currentLocation, nextLocation }) => dirty && currentLocation.pathname !== nextLocation.pathname);
  useEffect(() => {
    if (blocker.state !== 'blocked') return;
    confirmDialog({ title: 'Modifications non enregistrées', message: 'Quitter l’éditeur sans enregistrer ? Tes modifications seront perdues.', confirmLabel: 'Quitter sans enregistrer', danger: true }).then((ok) =>
      ok ? blocker.proceed() : blocker.reset(),
    );
  }, [blocker]);
  useEffect(() => {
    if (!dirty) return;
    const onUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener('beforeunload', onUnload);
    return () => window.removeEventListener('beforeunload', onUnload);
  }, [dirty]);

  const commit = useCallback(
    (next: GameRecord[]) => {
      if (!games) return;
      setPast((p) => [...p.slice(-80), games]);
      setFuture([]);
      setGames(next);
      setDirty(true);
    },
    [games],
  );

  const updateGame = useCallback(
    (gid: string, fn: (g: GameRecord) => GameRecord) => {
      if (!games) return;
      commit(games.map((g) => (g.id === gid ? { ...fn(g), modified: true, updatedAt: Date.now() } : g)));
    },
    [games, commit],
  );

  const undo = () => {
    if (!past.length || !games) return;
    setFuture((f) => [games, ...f]);
    setGames(past[past.length - 1]);
    setPast((p) => p.slice(0, -1));
    setDirty(true);
  };
  const redo = () => {
    if (!future.length || !games) return;
    setPast((p) => [...p, games]);
    setGames(future[0]);
    setFuture((f) => f.slice(1));
    setDirty(true);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest('input, textarea')) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        redo();
      } else if (e.key === 'ArrowLeft' && game) {
        const path = nodeId ? findPath(game.root, nodeId) : [];
        setNodeId(path && path.length > 1 ? path[path.length - 2].id : 0);
      } else if (e.key === 'ArrowRight' && game) {
        const n: TreeNode | null = nodeId ? findNode(game.root, nodeId) : game.root;
        const c = n?.children.find((x) => !x.invalid);
        if (c) setNodeId(c.id);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  if (loading || (!games && !notFound)) return <Loading />;
  if (notFound || !rep || !games)
    return (
      <div className="page">
        <EmptyState icon={<XCircle />} title="Répertoire introuvable" action={<Link className="btn" to="/bibliotheque">Bibliothèque</Link>} />
      </div>
    );

  const node: TreeNode | null = game ? (nodeId ? findNode(game.root, nodeId) : game.root) : null;
  const fen = node?.fen ?? START_FEN;
  const label = (g: GameRecord) => gameLabelFromHeaders(g.headers, ordered.indexOf(g));

  const save = async () => {
    setSaving(true);
    try {
      const changed = games.some((g) => g.modified) || games.length !== stored?.length;
      await lib.saveContent({ ...rep, modified: rep.modified || changed, gameOrder: rep.gameOrder.filter((x) => games.some((g) => g.id === x)).concat(games.filter((g) => !rep.gameOrder.includes(g.id)).map((g) => g.id)) }, games, 'Avant enregistrement depuis l’éditeur');
      setDirty(false);
      setPast([]);
      setFuture([]);
      toast.success('Répertoire enregistré', 'La version précédente est conservée dans l’historique.');
    } catch (e) {
      toast.error('Enregistrement impossible', e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const onBoardMove = (m: BoardMove) => {
    if (!game || !node) return;
    if (isMoveNode(node) && node.invalid) {
      toast.error('Coup invalide sélectionné', 'Choisis un coup valide ou corrige ce coup en mode texte.');
      return;
    }
    const r = addMove(game.root, nodeId, m, Math.max(game.maxId, maxNodeId(game.root)) + 1);
    if ('error' in r) {
      toast.error(r.error);
      return;
    }
    if (r.created) {
      updateGame(game.id, (g) => ({ ...g, root: r.root, maxId: Math.max(g.maxId, r.id) }));
      const parent = nodeId ? findNode(game.root, nodeId) : game.root;
      if (parent && parent.children.length > 0) toast.info('Variante ajoutée', 'Le coup a été ajouté comme nouvelle variante.');
    }
    setNodeId(r.id);
  };

  const editNode = (fn: (n: TreeNode) => TreeNode) => game && updateGame(game.id, (g) => ({ ...g, root: updateNode(g.root, nodeId, fn) }));

  const removeNode = async (target: MoveNode) => {
    if (!game) return;
    const size = subtreeSize(target) + 1;
    const comments = countTree({ fen: '', children: [target] } as GameRoot).comments;
    const ok =
      size <= 1 && !comments
        ? true
        : await confirmDialog({
            title: 'Supprimer ce coup et sa suite',
            danger: true,
            message: `${size} coup${size > 1 ? 's' : ''}${comments ? ` et ${comments} commentaire${comments > 1 ? 's' : ''}` : ''} seront supprimés de cette partie. Tu pourras annuler (Ctrl+Z) avant d’enregistrer.`,
            confirmLabel: 'Supprimer',
          });
    if (!ok) return;
    const path = findPath(game.root, target.id);
    updateGame(game.id, (g) => ({ ...g, root: deleteNode(g.root, target.id) }));
    setNodeId(path && path.length > 1 ? path[path.length - 2].id : 0);
  };

  const newGame = () => {
    const g = gameRecordFromParsed(parsePgn('[Event "Nouveau chapitre"]\n[Result "*"]\n\n*').games[0], rep.id);
    g.modified = true;
    commit([...games, g]);
    setParams({ partie: g.id });
    setNodeId(0);
  };

  const deleteGame = async (g: GameRecord) => {
    const c = countsOf(g);
    if (!(await confirmDialog({ title: 'Supprimer la partie', danger: true, message: `« ${label(g)} » (${c.moves} coups, ${c.comments} commentaires) sera retirée du répertoire. Annulable avant enregistrement ; après, une version est conservée dans l’historique.`, confirmLabel: 'Supprimer la partie' })))
      return;
    const rest = games.filter((x) => x.id !== g.id);
    commit(rest);
    setParams(rest[0] ? { partie: rest[0].id } : {});
    setNodeId(0);
  };

  const moveGame = (g: GameRecord, delta: -1 | 1) => {
    const order = ordered.map((x) => x.id);
    const i = order.indexOf(g.id);
    const j = i + delta;
    if (j < 0 || j >= order.length) return;
    [order[i], order[j]] = [order[j], order[i]];
    lib.updateMeta(rep.id, { gameOrder: order });
  };

  return (
    <div className="page page-wide">
      <PageHeader
        eyebrow={`Éditeur · ${rep.name}`}
        title="Modifier le répertoire"
        actions={
          <>
            <button className="btn" onClick={undo} disabled={!past.length} aria-label="Annuler" data-tip="Annuler (Ctrl+Z)">
              <Undo2 />
            </button>
            <button className="btn" onClick={redo} disabled={!future.length} aria-label="Rétablir" data-tip="Rétablir (Ctrl+Y)">
              <Redo2 />
            </button>
            <button
              className="btn"
              disabled={!dirty}
              onClick={async () => {
                if (await confirmDialog({ title: 'Annuler les modifications', message: 'Revenir à la dernière version enregistrée ?', confirmLabel: 'Tout annuler' })) {
                  setGames(structuredClone(stored ?? []));
                  setPast([]);
                  setFuture([]);
                  setDirty(false);
                }
              }}
            >
              Abandonner
            </button>
            <button className="btn btn-primary" onClick={save} disabled={!dirty || saving}>
              <Save /> {saving ? 'Enregistrement…' : 'Enregistrer'}
            </button>
            <button className="btn btn-ghost" onClick={() => navigate(`/repertoire/${rep.id}`)}>
              <Eye /> Explorer
            </button>
          </>
        }
      >
        {dirty ? 'Modifications non enregistrées.' : 'Toutes les modifications sont enregistrées.'} Les coups sont validés à chaque modification ; commentaires, variantes et en-têtes sont conservés.
      </PageHeader>

      <div className="editor">
        <aside className="editor-games card">
          <div className="row row-between">
            <strong>Parties ({ordered.length})</strong>
            <button className="btn btn-sm" onClick={newGame}>
              <FilePlus2 /> Ajouter
            </button>
          </div>
          <ul className="game-list">
            {ordered.map((g, i) => {
              const errs = g.issues.filter((x) => x.severity === 'error').length + countTree(g.root).invalid;
              return (
                <li key={g.id} className={g.id === game?.id ? 'is-active' : ''}>
                  <button
                    className="game-pick"
                    onClick={() => {
                      setParams({ partie: g.id });
                      setNodeId(0);
                    }}
                  >
                    <span className="truncate">{label(g)}</span>
                    <span className="row" style={{ gap: 4 }}>
                      {g.fatal && <span className="badge badge-danger">illisible</span>}
                      {!g.fatal && errs > 0 && <span className="badge badge-danger">{errs}</span>}
                      {g.modified && <span className="badge badge-info">modifiée</span>}
                    </span>
                  </button>
                  <span className="game-tools">
                    <button className="btn btn-ghost btn-icon btn-sm" disabled={i === 0} onClick={() => moveGame(g, -1)} aria-label="Monter">
                      <ArrowUp />
                    </button>
                    <button className="btn btn-ghost btn-icon btn-sm" disabled={i === ordered.length - 1} onClick={() => moveGame(g, 1)} aria-label="Descendre">
                      <ArrowDown />
                    </button>
                  </span>
                </li>
              );
            })}
          </ul>
        </aside>

        <section className="editor-main">
          <div className="row row-between row-wrap">
            <Segmented
              label="Mode d’édition"
              value={mode}
              onChange={setMode}
              options={[
                { value: 'visual', label: 'Visuel', icon: <Wand2 /> },
                { value: 'text', label: 'Texte (partie)', icon: <Code2 /> },
                { value: 'all', label: 'Texte (tout)', icon: <Code2 /> },
              ]}
            />
            {game && mode === 'visual' && (
              <div className="row">
                <button
                  className="btn btn-sm"
                  onClick={() => {
                    const copy = { ...structuredClone(game), id: newId(), modified: true, updatedAt: Date.now(), headers: game.headers.map(([k, v]) => [k, k === 'ChapterName' || k === 'Event' ? `${v} (copie)` : v]) as Array<[string, string]> };
                    commit([...games, copy]);
                    setParams({ partie: copy.id });
                  }}
                >
                  <Copy /> Dupliquer
                </button>
                <button className="btn btn-sm btn-danger" onClick={() => deleteGame(game)}>
                  <Trash2 /> Supprimer la partie
                </button>
              </div>
            )}
          </div>

          {!game && mode !== 'all' && (
            <div className="card">
              <EmptyState icon={<FilePlus2 />} title="Aucune partie" action={<button className="btn btn-primary" onClick={newGame}><Plus /> Ajouter une partie</button>} />
            </div>
          )}

          {game && mode === 'visual' && (
            <div className="editor-visual">
              <div className="editor-board">
                {game.fatal ? (
                  <div className="notice notice-danger">
                    <XCircle />
                    <div>
                      Cette partie n’a pas pu être lue (erreur de syntaxe). Son texte d’origine est conservé : corrige-le en <button className="btn btn-sm" onClick={() => setMode('text')}>mode texte</button>.
                    </div>
                  </div>
                ) : (
                  <>
                    <Board
                      fen={fen}
                      orientation={flip ? 'b' : 'w'}
                      interactive
                      movableColor="both"
                      onMove={onBoardMove}
                      lastMove={isMoveNode(node!) && node.uci ? { from: node.uci.slice(0, 2), to: node.uci.slice(2, 4) } : undefined}
                      shapes={node && 'shapes' in node ? node.shapes : undefined}
                      coordinates={settings.coordinates}
                      theme={settings.boardTheme}
                      pieceSet={settings.pieceSet}
                      animate={animationsEnabled(settings)}
                      label="Échiquier de l’éditeur : joue un coup pour l’ajouter"
                    />
                    <div className="board-controls">
                      <button className="btn btn-icon" aria-label="Début" onClick={() => setNodeId(0)}>
                        <CornerLeftUp />
                      </button>
                      <button
                        className="btn btn-icon"
                        aria-label="Coup précédent"
                        onClick={() => {
                          const path = nodeId ? findPath(game.root, nodeId) : [];
                          setNodeId(path && path.length > 1 ? path[path.length - 2].id : 0);
                        }}
                      >
                        <ChevronLeft />
                      </button>
                      <button
                        className="btn btn-icon"
                        aria-label="Coup suivant"
                        onClick={() => {
                          const c = node?.children.find((x) => !x.invalid);
                          if (c) setNodeId(c.id);
                        }}
                      >
                        <ChevronRight />
                      </button>
                      <button className="btn btn-sm" onClick={() => setFlip((f) => !f)}>
                        Retourner
                      </button>
                    </div>
                    <p className="small faint">Joue un coup sur l’échiquier pour l’ajouter après le coup sélectionné (en variante si une suite existe déjà).</p>
                  </>
                )}
              </div>
              <div className="editor-side stack">
                {!game.fatal && (
                  <div className="card pgn-view" aria-label="Coups de la partie">
                    <PgnView root={game.root} selected={nodeId} onSelect={setNodeId} notation={settings.notation} />
                  </div>
                )}
                {!game.fatal && node && <NodeTools game={game} node={node} onEdit={editNode} onDelete={removeNode} onPromote={(nid) => updateGame(game.id, (g) => ({ ...g, root: promoteNode(g.root, nid) }))} onShift={(nid, d) => updateGame(game.id, (g) => ({ ...g, root: moveVariation(g.root, nid, d) }))} />}
                <HeadersEditor game={game} onChange={(headers, root) => updateGame(game.id, (g) => ({ ...g, headers, root: root ?? g.root }))} />
              </div>
            </div>
          )}

          {game && mode === 'text' && (
            <TextEditor
              key={game.id + (game.modified ? game.updatedAt : '')}
              initial={game.modified || game.fatal ? (game.fatal ? game.rawPgn : exportGame(game.headers, game.root)) : game.rawPgn}
              before={[game]}
              onApply={(parsed) => {
                if (parsed.games.length === 1) {
                  const ng = gameRecordFromParsed(parsed.games[0], rep.id);
                  commit(games.map((g) => (g.id === game.id ? { ...ng, id: game.id, color: game.color, modified: true } : g)));
                } else {
                  const created = parsed.games.map((pg) => ({ ...gameRecordFromParsed(pg, rep.id), modified: true }));
                  const idx = games.findIndex((g) => g.id === game.id);
                  commit([...games.slice(0, idx), { ...created[0], id: game.id }, ...created.slice(1), ...games.slice(idx + 1)]);
                }
                setNodeId(0);
                setMode('visual');
                toast.success('Texte appliqué', 'Pense à enregistrer.');
              }}
            />
          )}

          {mode === 'all' && (
            <TextEditor
              key={'all' + games.length}
              initial={ordered.map((g) => (g.modified || g.fatal ? (g.fatal ? g.rawPgn : exportGame(g.headers, g.root)) : g.rawPgn).trim()).join('\n\n\n') + '\n'}
              before={ordered}
              onApply={(parsed) => {
                const next = parsed.games.map((pg, i) => {
                  const fresh = gameRecordFromParsed(pg, rep.id);
                  const prev = ordered[i];
                  return prev ? { ...fresh, id: prev.id, color: prev.color, modified: prev.rawPgn.trim() !== pg.rawPgn.trim() } : { ...fresh, modified: true };
                });
                commit(next);
                lib.updateMeta(rep.id, { gameOrder: next.map((g) => g.id) });
                setNodeId(0);
                setParams(next[0] ? { partie: next[0].id } : {});
                setMode('visual');
                toast.success('Texte appliqué', 'Pense à enregistrer.');
              }}
            />
          )}
        </section>
      </div>
    </div>
  );
}

/* ---------------- Vue PGN cliquable ---------------- */

function PgnView({ root, selected, onSelect, notation }: { root: GameRoot; selected: number; onSelect: (id: number) => void; notation: 'fr' | 'en' | 'figurine' }) {
  const renderMove = (n: MoveNode, fenBefore: string, forceNum: boolean): ReactNode => {
    const { moveNumber, color } = moveNumberFromFenBefore(fenBefore);
    if (n.invalid)
      return (
        <span key={n.id} className="pgn-invalid" title={n.invalid.error}>
          <button className={`pgn-move ${selected === n.id ? 'is-current' : ''}`} onClick={() => onSelect(n.id)}>
            ⚠ {n.invalid.head}
          </button>
          {n.invalid.tail && <span className="mono tiny"> {n.invalid.tail}</span>}
        </span>
      );
    return (
      <span key={n.id} className="pgn-token">
        {n.commentsBefore?.map((c, i) => (
          <span key={`b${i}`} className="pgn-comment">
            {c}
          </span>
        ))}
        <button className={`pgn-move ${selected === n.id ? 'is-current' : ''}`} onClick={() => onSelect(n.id)}>
          {color === 'w' ? `${moveNumber}.` : forceNum ? `${moveNumber}...` : ''}
          {formatSan(n.san, notation)}
          {nagText(n.nags) && <span className="nag">{nagText(n.nags)}</span>}
        </button>
        {n.comments?.map((c, i) => (
          <span key={`a${i}`} className="pgn-comment">
            {c}
          </span>
        ))}
      </span>
    );
  };
  const renderLine = (parent: TreeNode, force: boolean): ReactNode[] => {
    const out: ReactNode[] = [];
    let cur: TreeNode = parent;
    let need = force;
    for (;;) {
      if (!cur.children.length) break;
      const [main, ...vars] = cur.children;
      out.push(renderMove(main, cur.fen, need));
      need = !!main.comments?.length;
      if (vars.length) {
        out.push(
          <div key={`v${main.id}`} className="pgn-vars">
            {vars.map((v) => (
              <div key={v.id} className="pgn-var">
                {renderMove(v, cur.fen, true)}
                {!v.invalid && renderLine(v, !!v.comments?.length)}
              </div>
            ))}
          </div>,
        );
        need = true;
      }
      if (main.invalid) break;
      cur = main;
    }
    return out;
  };
  return (
    <div className="pgn">
      <button className={`pgn-move pgn-start ${selected === 0 ? 'is-current' : ''}`} onClick={() => onSelect(0)}>
        Départ
      </button>
      {root.comments?.map((c, i) => (
        <span key={i} className="pgn-comment">
          {c}
        </span>
      ))}
      {renderLine(root, true)}
      {!root.children.length && <p className="small faint">Aucun coup : joue le premier coup sur l’échiquier.</p>}
    </div>
  );
}

/* ---------------- Outils du coup sélectionné ---------------- */

function NodeTools({ game, node, onEdit, onDelete, onPromote, onShift }: { game: GameRecord; node: TreeNode; onEdit: (fn: (n: TreeNode) => TreeNode) => void; onDelete: (n: MoveNode) => void; onPromote: (id: number) => void; onShift: (id: number, d: -1 | 1) => void }) {
  const isMove = isMoveNode(node);
  const [comment, setComment] = useState('');
  const [before, setBefore] = useState('');
  useEffect(() => {
    setComment((node.comments ?? []).join('\n\n'));
    setBefore(isMove ? (node.commentsBefore ?? []).join('\n\n') : '');
  }, [node, isMove]);
  const path = isMove ? findPath(game.root, node.id) : null;
  const parent: TreeNode | null = path ? (path.length > 1 ? path[path.length - 2] : game.root) : null;
  const siblingIdx = parent && isMove ? parent.children.findIndex((c) => c.id === node.id) : -1;
  const splitComments = (t: string) =>
    t
      .split(/\n\s*\n/)
      .map((x) => x.trim())
      .filter(Boolean);
  const toggleNag = (n: number) =>
    onEdit((x) => {
      if (!isMoveNode(x)) return x;
      const nags = x.nags ?? [];
      const isMoveType = n <= 7;
      const filtered = nags.filter((k) => k !== n && (isMoveType ? k > 7 : k <= 7 || !POS_NAGS.includes(k)));
      return { ...x, nags: nags.includes(n) ? nags.filter((k) => k !== n) : [...filtered, n].sort((a, b) => a - b) };
    });
  return (
    <div className="card stack">
      <div className="row row-between">
        <strong>{isMove ? `Coup ${moveNumberFromFenBefore(parent?.fen ?? START_FEN).moveNumber}${sideToMove(parent?.fen ?? START_FEN) === 'w' ? '.' : '...'}${node.san}` : 'Position de départ'}</strong>
        {isMove && node.invalid && <span className="badge badge-danger">invalide</span>}
      </div>
      {isMove && node.invalid && (
        <div className="notice notice-danger">
          <AlertTriangle />
          <div>
            {node.invalid.error}. Suite conservée : <code>{node.invalid.tail || '—'}</code>. Corrige ce passage en mode texte, ou supprime-le.
          </div>
        </div>
      )}
      {isMove && !node.invalid && (
        <>
          <div className="field">
            <span className="field-label">Annotation du coup</span>
            <div className="row row-wrap" style={{ gap: 4 }}>
              {MOVE_NAGS.map((n) => (
                <button key={n} className="chip" aria-pressed={!!node.nags?.includes(n)} onClick={() => toggleNag(n)} title={NAG_LABELS[n]}>
                  {NAG_SYMBOLS[n]}
                </button>
              ))}
            </div>
          </div>
          <div className="field">
            <span className="field-label">Évaluation de la position</span>
            <div className="row row-wrap" style={{ gap: 4 }}>
              {POS_NAGS.map((n) => (
                <button key={n} className="chip" aria-pressed={!!node.nags?.includes(n)} onClick={() => toggleNag(n)} title={NAG_LABELS[n]}>
                  {NAG_SYMBOLS[n]}
                </button>
              ))}
            </div>
          </div>
        </>
      )}
      <div className="field">
        <label htmlFor="cmt">{isMove ? 'Commentaire après le coup' : 'Commentaire d’introduction'}</label>
        <textarea id="cmt" className="textarea" rows={3} value={comment} onChange={(e) => setComment(e.target.value)} onBlur={() => onEdit((x) => ({ ...x, comments: splitComments(comment) }))} placeholder="Une ligne vide sépare plusieurs commentaires." />
      </div>
      {isMove && (
        <div className="field">
          <label htmlFor="cmtb">Commentaire avant le coup</label>
          <textarea id="cmtb" className="textarea" rows={2} style={{ minHeight: 70 }} value={before} onChange={(e) => setBefore(e.target.value)} onBlur={() => onEdit((x) => (isMoveNode(x) ? { ...x, commentsBefore: splitComments(before) } : x))} />
        </div>
      )}
      {'shapes' in node && node.shapes && node.shapes.length > 0 && (
        <div className="row row-between small">
          <span className="muted">{node.shapes.length} flèche(s) / case(s) colorée(s)</span>
          <button className="btn btn-sm btn-ghost" onClick={() => onEdit((x) => ({ ...x, shapes: [] }))}>
            Effacer les flèches
          </button>
        </div>
      )}
      {isMove && (
        <div className="row row-wrap">
          {siblingIdx > 0 && (
            <button className="btn btn-sm" onClick={() => onPromote(node.id)}>
              <CheckCircle2 /> Promouvoir en ligne principale
            </button>
          )}
          {siblingIdx > 0 && (
            <button className="btn btn-sm btn-ghost" onClick={() => onShift(node.id, -1)} aria-label="Monter la variante">
              <ArrowUp />
            </button>
          )}
          {parent && siblingIdx >= 0 && siblingIdx < parent.children.length - 1 && (
            <button className="btn btn-sm btn-ghost" onClick={() => onShift(node.id, 1)} aria-label="Descendre la variante">
              <ArrowDown />
            </button>
          )}
          <button className="btn btn-sm btn-danger" onClick={() => onDelete(node)}>
            <Trash2 /> Supprimer à partir d’ici
          </button>
        </div>
      )}
    </div>
  );
}

/* ---------------- En-têtes ---------------- */

function HeadersEditor({ game, onChange }: { game: GameRecord; onChange: (h: Array<[string, string]>, root?: GameRoot) => void }) {
  const [rows, setRows] = useState(game.headers);
  useEffect(() => setRows(game.headers), [game.headers]);
  const commit = (next: Array<[string, string]>) => {
    const fenRow = next.find(([k]) => k === 'FEN');
    const oldFen = game.headers.find(([k]) => k === 'FEN')?.[1];
    if (fenRow && fenRow[1] !== oldFen) {
      const r = normalizeFen(fenRow[1]);
      if ('error' in r) {
        toast.error('FEN invalide', r.error);
        return;
      }
      if (game.root.children.length) {
        toast.error('Position de départ verrouillée', 'Change la FEN d’une partie sans coups, ou utilise le mode texte (les coups seront revalidés).');
        return;
      }
      onChange(next, { ...game.root, fen: r.fen });
      return;
    }
    onChange(next);
  };
  return (
    <details className="card headers-editor">
      <summary>
        <strong>En-têtes PGN</strong> <span className="faint small">({rows.length})</span>
      </summary>
      <div className="stack-sm" style={{ marginTop: 12 }}>
        {rows.map(([k, v], i) => (
          <div key={i} className="row">
            <input className="input mono" style={{ maxWidth: 150 }} value={k} aria-label="Nom de l’en-tête" onChange={(e) => setRows(rows.map((r, j) => (j === i ? [e.target.value.replace(/\W/g, ''), r[1]] : r)))} onBlur={() => commit(rows)} />
            <input className="input" value={v} aria-label={`Valeur de ${k}`} onChange={(e) => setRows(rows.map((r, j) => (j === i ? [r[0], e.target.value] : r)))} onBlur={() => commit(rows)} />
            <button className="btn btn-ghost btn-icon btn-sm" aria-label={`Supprimer l’en-tête ${k}`} onClick={() => commit(rows.filter((_, j) => j !== i))}>
              <Trash2 />
            </button>
          </div>
        ))}
        <button className="btn btn-sm" onClick={() => setRows([...rows, ['Tag', '']])}>
          <Plus /> Ajouter un en-tête
        </button>
      </div>
    </details>
  );
}

/* ---------------- Édition texte ---------------- */

function TextEditor({ initial, before, onApply }: { initial: string; before: GameRecord[]; onApply: (p: ParsedFile) => void }) {
  const [text, setText] = useState(initial);
  const [parsed, setParsed] = useState<ParsedFile | null>(null);
  const validate = () => setParsed(parsePgn(text));
  const b = before.reduce((s, g) => {
    const c = countsOf(g);
    return { moves: s.moves + c.moves, comments: s.comments + c.comments, variations: s.variations + c.variations };
  }, { moves: 0, comments: 0, variations: 0 });
  const losses = parsed
    ? [
        parsed.report.moves < b.moves ? `${b.moves - parsed.report.moves} coup(s) en moins` : '',
        parsed.report.comments < b.comments ? `${b.comments - parsed.report.comments} commentaire(s) en moins` : '',
        parsed.report.variations < b.variations ? `${b.variations - parsed.report.variations} variante(s) en moins` : '',
      ].filter(Boolean)
    : [];
  return (
    <div className="card stack">
      <div className="field">
        <label htmlFor="pgn-text">PGN</label>
        <textarea id="pgn-text" className="textarea mono" rows={22} value={text} spellCheck={false} onChange={(e) => {
          setText(e.target.value);
          setParsed(null);
        }} />
      </div>
      <div className="row row-wrap">
        <button className="btn" onClick={validate}>
          <CheckCircle2 /> Valider
        </button>
        <button
          className="btn btn-primary"
          disabled={!parsed || !parsed.games.length}
          onClick={async () => {
            if (!parsed) return;
            if (losses.length && !(await confirmDialog({ title: 'Du contenu va disparaître', danger: true, message: `Par rapport à la version actuelle : ${losses.join(', ')}. Appliquer quand même ?`, confirmLabel: 'Appliquer' }))) return;
            onApply(parsed);
          }}
        >
          Appliquer
        </button>
        <button className="btn btn-ghost" onClick={() => setText(initial)}>
          Réinitialiser
        </button>
      </div>
      {parsed && (
        <div className="stack">
          <ReportStatsGrid s={parsed.report} />
          {losses.length > 0 && (
            <div className="notice notice-warning">
              <AlertTriangle />
              <div>Attention : {losses.join(', ')} par rapport à la version actuelle.</div>
            </div>
          )}
          <IssuesList issues={parsed.report.issues} />
        </div>
      )}
    </div>
  );
}
