import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import {
  BookOpen,
  Copy,
  Download,
  FolderPlus,
  Folder as FolderIcon,
  GitMerge,
  MoreHorizontal,
  Pencil,
  Play,
  RefreshCw,
  Search,
  Star,
  Tag,
  Trash2,
  Upload,
  Undo2,
  Compass,
  CheckSquare,
  X,
} from 'lucide-react';
import { useLibrary } from '../state/library';
import { derive, masterySummary, userPositionKeys } from '../state/derived';
import { useSettings } from '../state/settings';
import { repertoireColor, header, type GameRecord, type Repertoire } from '../core/repertoire/types';
import { exportRepertoirePgn, safeFileName } from '../core/repertoire/export';
import { matchMoves } from '../core/repertoire/search';
import { fullSelection } from '../core/repertoire/selection';
import { listTrash, purgeTrash, restoreFromTrash } from '../storage/repo';
import type { TrashEntry } from '../storage/db';
import { ColorDot, EmptyState, Loading, MasteryBar, Menu, Modal, confirmDialog, downloadText, formatRelative, promptDialog, toast } from '../ui/kit';
import { MiniBoard, PageHeader, sessionConfig, startSessionAndGo } from './common';
import { reloadFromSource } from './reloadSource';

type Sort = 'recent' | 'name' | 'mastery' | 'due';

function textMatch(rep: Repertoire, games: GameRecord[] | undefined, q: string): string | null {
  const s = q.toLowerCase();
  if (rep.name.toLowerCase().includes(s)) return null;
  if (rep.tags.some((t) => t.toLowerCase().includes(s))) return 'étiquette';
  for (const g of games ?? []) {
    for (const key of ['ECO', 'Opening', 'Variation']) if (header(g.headers, key).toLowerCase().includes(s)) return `${key === 'ECO' ? 'ECO' : 'ouverture'} : ${header(g.headers, key)}`;
    for (const key of ['White', 'Black', 'Annotator', 'ChapterName', 'Event']) if (header(g.headers, key).toLowerCase().includes(s)) return `${key === 'White' || key === 'Black' ? 'joueur' : 'partie'} : ${header(g.headers, key)}`;
  }
  for (const g of games ?? []) {
    const stack = [...g.root.children];
    if (g.root.comments?.some((c) => c.toLowerCase().includes(s))) return 'commentaire';
    while (stack.length) {
      const n = stack.pop()!;
      if (n.comments?.some((c) => c.toLowerCase().includes(s)) || n.commentsBefore?.some((c) => c.toLowerCase().includes(s))) return 'commentaire';
      stack.push(...n.children);
    }
  }
  return '';
}

export default function Library() {
  const navigate = useNavigate();
  const lib = useLibrary();
  const { loaded, repertoires, folders, cards, games, loadGames } = lib;
  const settings = useSettings((s) => s.settings);
  const [q, setQ] = useState('');
  const [folder, setFolder] = useState<string>('all');
  const [sort, setSort] = useState<Sort>('recent');
  const [tag, setTag] = useState<string | null>(null);
  const [selecting, setSelecting] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [trash, setTrash] = useState<TrashEntry[] | null>(null);
  const [now] = useState(() => Date.now());

  useEffect(() => {
    for (const r of repertoires) if (!games[r.id]) loadGames(r.id);
  }, [repertoires, games, loadGames]);

  const allTags = useMemo(() => [...new Set(repertoires.flatMap((r) => r.tags))].sort(), [repertoires]);

  const rows = useMemo(() => {
    return repertoires.map((rep) => {
      const g = games[rep.id];
      const d = g ? derive(rep, g) : undefined;
      const mastery = d && g ? masterySummary(rep.id, userPositionKeys(rep, g, d.forest), cards, now) : undefined;
      let match: string | null = null;
      let visible = true;
      if (q.trim()) {
        const t = textMatch(rep, g, q.trim());
        if (t === '') {
          if (d && matchMoves(d.forest, q, settings.notation)) match = 'séquence de coups';
          else visible = false;
        } else match = t;
      }
      return { rep, d, mastery, match, visible };
    });
  }, [repertoires, games, cards, now, q, settings.notation]);

  const shown = rows
    .filter((r) => r.visible)
    .filter((r) => (folder === 'all' ? true : folder === 'fav' ? r.rep.favorite : folder === 'none' ? !r.rep.folderId : r.rep.folderId === folder))
    .filter((r) => !tag || r.rep.tags.includes(tag))
    .sort((a, b) => {
      if (sort === 'name') return a.rep.name.localeCompare(b.rep.name, 'fr');
      if (sort === 'mastery') return (a.mastery?.score ?? 0) - (b.mastery?.score ?? 0);
      if (sort === 'due') return (b.mastery?.due ?? 0) - (a.mastery?.due ?? 0);
      return (b.rep.lastOpenedAt ?? b.rep.lastReviewedAt ?? b.rep.updatedAt) - (a.rep.lastOpenedAt ?? a.rep.lastReviewedAt ?? a.rep.updatedAt);
    });

  if (!loaded) return <Loading />;

  const openTrash = async () => setTrash(await listTrash());

  const exportRep = async (rep: Repertoire) => {
    const g = await loadGames(rep.id);
    const notes = new Map([...cards.values()].filter((c) => c.repertoireId === rep.id && c.note).map((c) => [c.posKey, c.note!]));
    downloadText(safeFileName(rep.name), exportRepertoirePgn(rep, g, { annotations: true, notes }));
    toast.success('PGN exporté', 'Commentaires, variantes et annotations personnelles inclus.');
  };

  const removeRep = async (rep: Repertoire) => {
    const ok = await confirmDialog({
      title: 'Supprimer le répertoire',
      danger: true,
      message: `« ${rep.name} » et sa progression seront placés dans la corbeille. Tu pourras les restaurer tant que la corbeille n’est pas vidée.`,
      confirmLabel: 'Mettre à la corbeille',
    });
    if (!ok) return;
    await lib.remove(rep.id);
    toast.success('Répertoire placé dans la corbeille');
  };

  const merge = async () => {
    const ids = [...picked];
    if (ids.length < 2) return;
    const name = await promptDialog({ title: 'Fusionner les répertoires', label: 'Nom du nouveau répertoire', defaultValue: 'Répertoire fusionné', message: 'Les répertoires d’origine sont conservés.' });
    if (!name) return;
    const rep = await lib.merge(ids, name);
    setSelecting(false);
    setPicked(new Set());
    if (rep) {
      toast.success('Répertoires fusionnés', `${rep.stats.games} parties réunies dans « ${rep.name} ».`);
      navigate(`/repertoire/${rep.id}`);
    }
  };

  return (
    <div className="page">
      <PageHeader
        eyebrow="Bibliothèque"
        title="Mes répertoires"
        actions={
          <>
            <button className="btn" onClick={openTrash}>
              <Trash2 /> Corbeille
            </button>
            <button
              className="btn"
              onClick={async () => {
                const name = await promptDialog({ title: 'Nouveau dossier', label: 'Nom du dossier' });
                if (name) await lib.createFolder(name);
              }}
            >
              <FolderPlus /> Dossier
            </button>
            {repertoires.length > 1 && (
              <button className="btn" aria-pressed={selecting} onClick={() => setSelecting((s) => !s)}>
                {selecting ? <X /> : <CheckSquare />} {selecting ? 'Annuler' : 'Sélectionner'}
              </button>
            )}
            <Link to="/importer" className="btn btn-primary">
              <Upload /> Importer
            </Link>
          </>
        }
      />

      {repertoires.length > 0 && (
        <div className="toolbar">
          <div className="input-with-icon grow" style={{ minWidth: 240 }}>
            <Search />
            <input className="input" type="search" placeholder="Nom, ECO, joueur, commentaire ou coups (ex. e4 c5 Cf3)…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Rechercher" />
          </div>
          <select className="select" style={{ width: 'auto' }} value={sort} onChange={(e) => setSort(e.target.value as Sort)} aria-label="Trier">
            <option value="recent">Récemment utilisés</option>
            <option value="name">Nom</option>
            <option value="due">Révisions en attente</option>
            <option value="mastery">Moins maîtrisés d’abord</option>
          </select>
        </div>
      )}

      {repertoires.length > 0 && (
        <div className="row row-wrap" role="group" aria-label="Filtrer par dossier">
          <button className="chip" aria-pressed={folder === 'all'} onClick={() => setFolder('all')}>
            Tous <span className="faint">{repertoires.length}</span>
          </button>
          <button className="chip" aria-pressed={folder === 'fav'} onClick={() => setFolder('fav')}>
            <Star /> Favoris
          </button>
          {folders.map((f) => (
            <span key={f.id} className="row" style={{ gap: 2 }}>
              <button className="chip" aria-pressed={folder === f.id} onClick={() => setFolder(f.id)}>
                <FolderIcon /> {f.name} <span className="faint">{repertoires.filter((r) => r.folderId === f.id).length}</span>
              </button>
              {folder === f.id && (
                <Menu label={`Dossier ${f.name}`} trigger={(open) => <button className="btn btn-ghost btn-icon btn-sm" aria-label={`Actions du dossier ${f.name}`} onClick={open}><MoreHorizontal /></button>}>
                  {(close) => (
                    <>
                      <button
                        onClick={async () => {
                          close();
                          const name = await promptDialog({ title: 'Renommer le dossier', label: 'Nom', defaultValue: f.name });
                          if (name) await lib.renameFolder(f.id, name);
                        }}
                      >
                        <Pencil /> Renommer
                      </button>
                      <button
                        className="danger"
                        onClick={async () => {
                          close();
                          if (await confirmDialog({ title: 'Supprimer le dossier', message: 'Les répertoires qu’il contient ne sont pas supprimés : ils reviennent dans « Sans dossier ».', confirmLabel: 'Supprimer le dossier' })) {
                            await lib.deleteFolder(f.id);
                            setFolder('all');
                          }
                        }}
                      >
                        <Trash2 /> Supprimer le dossier
                      </button>
                    </>
                  )}
                </Menu>
              )}
            </span>
          ))}
          {folders.length > 0 && (
            <button className="chip" aria-pressed={folder === 'none'} onClick={() => setFolder('none')}>
              Sans dossier
            </button>
          )}
          {allTags.map((t) => (
            <button key={t} className="chip" aria-pressed={tag === t} onClick={() => setTag(tag === t ? null : t)}>
              <Tag /> {t}
            </button>
          ))}
        </div>
      )}

      {selecting && (
        <div className="selection-bar">
          <span>
            {picked.size} répertoire{picked.size > 1 ? 's' : ''} sélectionné{picked.size > 1 ? 's' : ''}
          </span>
          <button className="btn btn-primary btn-sm" disabled={picked.size < 2} onClick={merge}>
            <GitMerge /> Fusionner
          </button>
          <button
            className="btn btn-sm"
            disabled={picked.size < 1}
            onClick={() => startSessionAndGo(sessionConfig('full', [...picked].map((id) => fullSelection(id))), navigate)}
          >
            <Play /> Réviser ensemble
          </button>
          <button
            className="btn btn-sm"
            disabled={picked.size < 1}
            onClick={async () => {
              const parts: string[] = [];
              for (const id of picked) {
                const rep = repertoires.find((r) => r.id === id);
                if (!rep) continue;
                const g = await loadGames(id);
                const notes = new Map([...cards.values()].filter((c) => c.repertoireId === id && c.note).map((c) => [c.posKey, c.note!]));
                parts.push(exportRepertoirePgn(rep, g, { annotations: true, notes }).trim());
              }
              downloadText(safeFileName(picked.size === 1 ? repertoires.find((r) => picked.has(r.id))?.name ?? 'repertoires' : `${picked.size} repertoires`), parts.join('\n\n\n') + '\n');
              toast.success('PGN exporté', `${picked.size} répertoire(s) dans un seul fichier.`);
            }}
          >
            <Download /> Exporter en PGN
          </button>
        </div>
      )}

      {!repertoires.length ? (
        <div className="card">
          <EmptyState icon={<BookOpen />} title="Ta bibliothèque est vide" action={<Link to="/importer" className="btn btn-primary"><Upload /> Importer un PGN</Link>}>
            Importe un fichier PGN (étude Lichess, export ChessBase, fichier personnel…) pour créer ton premier répertoire.
          </EmptyState>
        </div>
      ) : !shown.length ? (
        <div className="card">
          <EmptyState icon={<Search />} title="Aucun résultat">
            Aucun répertoire ne correspond à cette recherche ou à ce filtre.
          </EmptyState>
        </div>
      ) : (
        <div className="grid grid-auto">
          {shown.map(({ rep, d, mastery, match }) => {
            const color = repertoireColor(rep);
            const pct = mastery?.total ? Math.round(((mastery.counts.mastered + mastery.counts.solid) / mastery.total) * 100) : 0;
            return (
              <article key={rep.id} className={`card rep-card ${picked.has(rep.id) ? 'is-picked' : ''}`} data-testid="repertoire-card">
                {selecting && (
                  <input
                    type="checkbox"
                    className="checkbox rep-pick"
                    aria-label={`Sélectionner ${rep.name}`}
                    checked={picked.has(rep.id)}
                    onChange={(e) => {
                      const n = new Set(picked);
                      if (e.target.checked) n.add(rep.id);
                      else n.delete(rep.id);
                      setPicked(n);
                    }}
                  />
                )}
                <Link to={`/repertoire/${rep.id}`} className="rep-preview" aria-label={`Ouvrir ${rep.name}`}>
                  {d?.trunk ? <MiniBoard fen={d.trunk.fen} orientation={color} label={`Aperçu de ${rep.name}`} /> : <div className="skeleton" style={{ aspectRatio: '1' }} />}
                </Link>
                <div className="rep-body">
                  <div className="row row-between" style={{ alignItems: 'flex-start' }}>
                    <Link to={`/repertoire/${rep.id}`} className="rep-title">
                      {rep.name}
                    </Link>
                    <RepMenu
                      rep={rep}
                      onExport={() => exportRep(rep)}
                      onRemove={() => removeRep(rep)}
                      onReload={async () => {
                        const u = await reloadFromSource(rep);
                        if (u) await loadGames(rep.id, true);
                      }}
                    />
                  </div>
                  <div className="row row-wrap" style={{ gap: 6 }}>
                    <span className="badge">
                      <ColorDot color={color} /> {color === 'w' ? 'Blancs' : 'Noirs'}
                    </span>
                    {rep.favorite && (
                      <span className="badge badge-gold">
                        <Star /> Favori
                      </span>
                    )}
                    {rep.source.kind === 'demo' && <span className="badge badge-violet">Démonstration</span>}
                    {rep.source.kind === 'github' && <span className="badge badge-info">GitHub</span>}
                    {rep.stats.errors > 0 && <span className="badge badge-danger">{rep.stats.errors} erreur{rep.stats.errors > 1 ? 's' : ''}</span>}
                    {rep.folderId && <span className="badge">{folders.find((f) => f.id === rep.folderId)?.name}</span>}
                    {rep.tags.map((t) => (
                      <span key={t} className="badge">
                        #{t}
                      </span>
                    ))}
                  </div>
                  {match && <div className="small text-accent">Correspondance : {match}</div>}
                  <div className="rep-stats small muted">
                    <span>
                      <b>{rep.stats.lines}</b> variantes
                    </span>
                    <span>
                      <b>{rep.stats.positions}</b> positions
                    </span>
                    <span>
                      <b>{rep.stats.games}</b> parties
                    </span>
                  </div>
                  {mastery && (
                    <div className="stack-sm">
                      <div className="row row-between small">
                        <span className="muted">Maîtrise</span>
                        <span className="tabular">
                          <b>{pct} %</b> <span className="faint">({mastery.counts.mastered + mastery.counts.solid}/{mastery.total})</span>
                        </span>
                      </div>
                      <MasteryBar counts={mastery.counts} total={mastery.total} />
                    </div>
                  )}
                  <div className="row row-between small">
                    <span className="faint">Révisé {formatRelative(rep.lastReviewedAt)}</span>
                    {mastery && mastery.due > 0 ? <span className="badge badge-warning">{mastery.due} à réviser</span> : <span className="faint">à jour</span>}
                  </div>
                  <div className="row row-wrap" style={{ gap: 6 }}>
                    <button className="btn btn-primary btn-sm" onClick={() => navigate(`/session/nouvelle?rep=${rep.id}`)}>
                      <Play /> Réviser
                    </button>
                    <Link className="btn btn-sm" to={`/repertoire/${rep.id}`}>
                      <Compass /> Explorer
                    </Link>
                    <Link className="btn btn-sm btn-ghost" to={`/repertoire/${rep.id}/editer`}>
                      <Pencil /> Éditer
                    </Link>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {trash && (
        <Modal title="Corbeille" onClose={() => setTrash(null)} wide>
          {!trash.length ? (
            <EmptyState icon={<Trash2 />} title="Corbeille vide" />
          ) : (
            <ul className="list">
              {trash.map((t) => (
                <li key={t.id}>
                  <div className="grow">
                    <div style={{ fontWeight: 650 }}>{t.repertoire.name}</div>
                    <div className="small faint">
                      Supprimé {formatRelative(t.deletedAt)} · {t.games.length} parties · {t.cards.length} positions suivies
                    </div>
                  </div>
                  <button
                    className="btn btn-sm"
                    onClick={async () => {
                      await restoreFromTrash(t.id);
                      await lib.refresh();
                      setTrash(await listTrash());
                      toast.success('Répertoire restauré');
                    }}
                  >
                    <Undo2 /> Restaurer
                  </button>
                  <button
                    className="btn btn-sm btn-danger"
                    onClick={async () => {
                      if (await confirmDialog({ title: 'Supprimer définitivement', danger: true, message: `« ${t.repertoire.name} » et sa progression seront effacés sans retour possible.`, confirmLabel: 'Supprimer définitivement' })) {
                        await purgeTrash(t.id);
                        setTrash(await listTrash());
                      }
                    }}
                  >
                    <Trash2 />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Modal>
      )}
    </div>
  );
}

function RepMenu({ rep, onExport, onRemove, onReload }: { rep: Repertoire; onExport: () => void; onRemove: () => void; onReload: () => void }) {
  const lib = useLibrary();
  return (
    <Menu label={`Actions pour ${rep.name}`} trigger={(open) => <button className="btn btn-ghost btn-icon btn-sm" aria-label={`Actions pour ${rep.name}`} onClick={open}><MoreHorizontal /></button>}>
      {(close) => (
        <>
          <button
            onClick={async () => {
              close();
              const name = await promptDialog({ title: 'Renommer', label: 'Nom du répertoire', defaultValue: rep.name });
              if (name) await lib.updateMeta(rep.id, { name });
            }}
          >
            <Pencil /> Renommer
          </button>
          <button
            onClick={() => {
              close();
              lib.updateMeta(rep.id, { favorite: !rep.favorite });
            }}
          >
            <Star /> {rep.favorite ? 'Retirer des favoris' : 'Ajouter aux favoris'}
          </button>
          <button
            onClick={async () => {
              close();
              const t = await promptDialog({ title: 'Étiquettes', label: 'Étiquettes séparées par des virgules', defaultValue: rep.tags.join(', ') });
              if (t != null) await lib.updateMeta(rep.id, { tags: [...new Set(t.split(',').map((x) => x.trim()).filter(Boolean))] });
            }}
          >
            <Tag /> Étiquettes
          </button>
          {lib.folders.length > 0 && (
            <>
              <hr />
              {[{ id: null as string | null, name: 'Sans dossier' }, ...lib.folders].map((f) => (
                <button
                  key={f.id ?? 'none'}
                  onClick={() => {
                    close();
                    lib.updateMeta(rep.id, { folderId: f.id });
                  }}
                  aria-current={rep.folderId === f.id}
                >
                  <FolderIcon /> {rep.folderId === f.id ? '✓ ' : ''}
                  {f.name}
                </button>
              ))}
            </>
          )}
          <hr />
          {(['auto', 'w', 'b'] as const).map((c) => (
            <button
              key={c}
              onClick={() => {
                close();
                lib.updateMeta(rep.id, { color: c });
              }}
            >
              <ColorDot color={c === 'auto' ? rep.detectedColor : c} /> {rep.color === c ? '✓ ' : ''}Je joue {c === 'auto' ? `(auto : ${rep.detectedColor === 'w' ? 'Blancs' : 'Noirs'})` : c === 'w' ? 'les Blancs' : 'les Noirs'}
            </button>
          ))}
          <hr />
          <button
            onClick={async () => {
              close();
              const name = await promptDialog({ title: 'Dupliquer', label: 'Nom de la copie', defaultValue: `${rep.name} (copie)` });
              if (name) {
                await lib.duplicate(rep.id, name);
                toast.success('Répertoire dupliqué', 'La copie démarre sans progression.');
              }
            }}
          >
            <Copy /> Dupliquer
          </button>
          <button
            onClick={() => {
              close();
              onExport();
            }}
          >
            <Download /> Exporter le PGN
          </button>
          <button
            onClick={() => {
              close();
              onReload();
            }}
          >
            <RefreshCw /> Recharger depuis la source
          </button>
          <hr />
          <button
            className="danger"
            onClick={() => {
              close();
              onRemove();
            }}
          >
            <Trash2 /> Supprimer
          </button>
        </>
      )}
    </Menu>
  );
}

