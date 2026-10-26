import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { ClipboardPaste, FileUp, FolderGit2, Globe, Info, KeyRound, Loader2, Search, Trash2, Upload, AlertTriangle } from 'lucide-react';
import type { Color } from '../core/chess/fen';
import type { ParsedFile } from '../core/pgn/types';
import { defaultNameFromFile, hashText } from '../core/repertoire/build';
import { buildForest, detectColor } from '../core/repertoire/merged';
import type { SourceInfo } from '../core/repertoire/types';
import { gameRecordFromParsed } from '../core/repertoire/build';
import { parseInBackground, readPgnFile } from '../workers/parseClient';
import { fetchGithubFile, fetchUrlText, getToken, listPgnFiles, parseGithubInput, toRawUrl, type GithubFile } from '../integrations/github';
import { useLibrary } from '../state/library';
import { DEFAULT_GITHUB_REPO, IS_ARTIFACT_PREVIEW } from '../config';
import { Segmented, Tabs, toast } from '../ui/kit';
import { PageHeader } from './common';
import { importParsed } from './importHelpers';
import { IssuesList, ReportStatsGrid } from './ImportReport';

interface Pending {
  id: number;
  name: string;
  fileLabel: string;
  encoding?: string;
  parsed: ParsedFile;
  source: SourceInfo;
  detected: Color;
  color: Color | 'auto';
  duplicateOf?: string;
}

type Tab = 'files' | 'paste' | 'github' | 'url';
let pid = 0;

export default function ImportPage() {
  const navigate = useNavigate();
  const { repertoires, folders } = useLibrary();
  const [tab, setTab] = useState<Tab>('files');
  const [pending, setPending] = useState<Pending[]>([]);
  const [busy, setBusy] = useState<{ label: string; done: number; total: number } | null>(null);
  const [folderId, setFolderId] = useState<string>('');
  const [drag, setDrag] = useState(false);
  const [paste, setPaste] = useState('');
  const [ghInput, setGhInput] = useState(DEFAULT_GITHUB_REPO);
  const [ghFiles, setGhFiles] = useState<{ files: GithubFile[]; owner: string; repo: string; ref: string; private: boolean } | null>(null);
  const [ghChecked, setGhChecked] = useState<Set<string>>(new Set());
  const [hasToken, setHasToken] = useState(false);
  const [url, setUrl] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    getToken().then((t) => setHasToken(!!t));
  }, []);

  const addParsed = (text: string, parsed: ParsedFile, fileLabel: string, source: Omit<SourceInfo, 'contentHash' | 'importedAt'>, encoding?: string) => {
    const hash = hashText(text);
    const games = parsed.games.map((g) => gameRecordFromParsed(g, 'tmp'));
    const detected = detectColor(games, buildForest(games));
    const dup = repertoires.find((r) => r.source.contentHash === hash);
    setPending((p) => [
      ...p,
      {
        id: ++pid,
        name: defaultNameFromFile(source.fileName ?? fileLabel, parsed),
        fileLabel,
        encoding,
        parsed,
        source: { ...source, contentHash: hash, importedAt: Date.now() },
        detected,
        color: 'auto',
        duplicateOf: dup?.name,
      },
    ]);
  };

  const parseText = async (text: string, label: string) => {
    setBusy({ label: `Analyse de ${label}…`, done: 0, total: 1 });
    try {
      return await parseInBackground(text, (done, total) => setBusy({ label: `Analyse de ${label}…`, done, total }));
    } finally {
      setBusy(null);
    }
  };

  const onFiles = async (files: FileList | File[]) => {
    const list = [...files].filter((f) => /\.(pgn|txt)$/i.test(f.name) || f.type.includes('pgn') || f.type === 'text/plain');
    const skipped = [...files].length - list.length;
    if (skipped) toast.info(`${skipped} fichier(s) ignoré(s)`, 'Seuls les fichiers .pgn ou .txt sont acceptés.');
    for (const f of list) {
      try {
        const { text, encoding } = await readPgnFile(f);
        const parsed = await parseText(text, f.name);
        addParsed(text, parsed, f.name, { kind: 'file', fileName: f.name, fileLastModified: f.lastModified }, encoding);
      } catch (e) {
        toast.error(`Lecture impossible : ${f.name}`, e instanceof Error ? e.message : String(e));
      }
    }
  };

  const onPaste = async () => {
    if (!paste.trim()) return;
    const parsed = await parseText(paste, 'texte collé');
    addParsed(paste, parsed, 'Texte collé', { kind: 'paste' });
    setPaste('');
  };

  const ghList = async () => {
    const ref = parseGithubInput(ghInput);
    if (!ref) {
      toast.error('Adresse GitHub non reconnue', 'Exemples : propriétaire/dépôt ou https://github.com/propriétaire/dépôt/blob/main/fichier.pgn');
      return;
    }
    setBusy({ label: 'Lecture du dépôt GitHub…', done: 0, total: 0 });
    try {
      const token = await getToken();
      if (ref.path && /\.pgn$/i.test(ref.path)) {
        const f = await fetchGithubFile({ ...ref, path: ref.path }, token);
        const parsed = await parseText(f.text, ref.path);
        addParsed(f.text, parsed, ref.path.split('/').pop()!, {
          kind: 'github',
          fileName: ref.path.split('/').pop(),
          url: f.htmlUrl,
          github: { owner: ref.owner, repo: ref.repo, path: ref.path, ref: f.ref, sha: f.sha },
        });
        setGhFiles(null);
      } else {
        const r = await listPgnFiles(ref, token);
        setGhFiles({ files: r.files, owner: ref.owner, repo: ref.repo, ref: r.ref, private: r.private });
        setGhChecked(new Set(r.files.map((f) => f.path)));
        if (!r.files.length) toast.info('Aucun fichier .pgn dans ce dépôt', `Branche ${r.ref}.`);
      }
    } catch (e) {
      toast.error('GitHub', e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const ghImportChecked = async () => {
    if (!ghFiles) return;
    const token = await getToken();
    for (const f of ghFiles.files.filter((x) => ghChecked.has(x.path))) {
      try {
        setBusy({ label: `Téléchargement de ${f.path}…`, done: 0, total: 0 });
        const file = await fetchGithubFile({ owner: ghFiles.owner, repo: ghFiles.repo, ref: ghFiles.ref, path: f.path }, token);
        const parsed = await parseText(file.text, f.path);
        addParsed(file.text, parsed, f.path.split('/').pop()!, {
          kind: 'github',
          fileName: f.path.split('/').pop(),
          url: file.htmlUrl,
          github: { owner: ghFiles.owner, repo: ghFiles.repo, path: f.path, ref: ghFiles.ref, sha: file.sha ?? f.sha, private: ghFiles.private },
        });
      } catch (e) {
        toast.error(`GitHub : ${f.path}`, e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(null);
      }
    }
    setGhFiles(null);
  };

  const onUrl = async () => {
    const target = toRawUrl(url.trim());
    if (!/^https:\/\//.test(target)) {
      toast.error('Adresse invalide', 'Utilise une adresse https:// vers un fichier PGN brut.');
      return;
    }
    const gh = parseGithubInput(url.trim());
    if (gh?.path) {
      setGhInput(url.trim());
      setTab('github');
      toast.info('Adresse GitHub détectée', 'Utilise l’onglet GitHub : il conserve la référence pour recharger le fichier plus tard.');
      return;
    }
    setBusy({ label: 'Téléchargement…', done: 0, total: 0 });
    try {
      const text = await fetchUrlText(target);
      const name = decodeURIComponent(target.split('/').pop() ?? 'fichier.pgn');
      const parsed = await parseText(text, name);
      addParsed(text, parsed, name, { kind: 'url', url: target, fileName: name });
      setUrl('');
    } catch (e) {
      toast.error('Téléchargement impossible', e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const doImport = async (items: Pending[]) => {
    const created = [];
    for (const p of items) {
      if (!p.parsed.games.length) {
        toast.error(`« ${p.name} » ne contient aucune partie`, 'Rien à importer.');
        continue;
      }
      try {
        const rep = await importParsed(p.parsed, { name: p.name.trim() || 'Répertoire', source: p.source, color: p.color, folderId: folderId || null });
        created.push(rep);
      } catch (e) {
        toast.error(`Import de « ${p.name} » impossible`, e instanceof Error ? e.message : String(e));
      }
    }
    setPending((list) => list.filter((x) => !items.includes(x)));
    if (created.length === 1) {
      toast.success('Répertoire importé', `${created[0].stats.games} parties, ${created[0].stats.lines} lignes.`);
      navigate(`/repertoire/${created[0].id}`);
    } else if (created.length > 1) {
      toast.success(`${created.length} répertoires importés`);
      navigate('/bibliotheque');
    }
  };

  return (
    <div className="page page-narrow">
      <PageHeader eyebrow="Import" title="Importer des PGN">
        Ajoute un ou plusieurs fichiers : parties multiples, variantes imbriquées, commentaires, NAG, flèches et positions FEN sont pris en charge. Chaque coup est
        vérifié.
      </PageHeader>

      <div className="card">
        <Tabs
          label="Source"
          value={tab}
          onChange={setTab}
          tabs={[
            { value: 'files', label: 'Fichiers', icon: <FileUp /> },
            { value: 'paste', label: 'Coller', icon: <ClipboardPaste /> },
            { value: 'github', label: 'GitHub', icon: <FolderGit2 /> },
            { value: 'url', label: 'Adresse web', icon: <Globe /> },
          ]}
        />
        <div style={{ paddingTop: 18 }}>
          {tab === 'files' && (
            <div
              className={`dropzone ${drag ? 'drag' : ''}`}
              role="button"
              tabIndex={0}
              onClick={() => fileRef.current?.click()}
              onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && fileRef.current?.click()}
              onDragOver={(e) => {
                e.preventDefault();
                setDrag(true);
              }}
              onDragLeave={() => setDrag(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDrag(false);
                onFiles(e.dataTransfer.files);
              }}
            >
              <Upload />
              <div>
                <strong>Glisse tes fichiers PGN ici</strong>
                <div className="muted small">ou clique pour les choisir — plusieurs fichiers acceptés</div>
              </div>
              <input
                ref={fileRef}
                type="file"
                accept=".pgn,.txt,application/x-chess-pgn,text/plain"
                multiple
                hidden
                data-testid="file-input"
                onChange={(e) => {
                  if (e.target.files) onFiles(e.target.files);
                  e.target.value = '';
                }}
              />
            </div>
          )}
          {tab === 'paste' && (
            <div className="stack">
              <div className="field">
                <label htmlFor="paste">Texte PGN</label>
                <textarea id="paste" className="textarea mono" rows={10} value={paste} onChange={(e) => setPaste(e.target.value)} placeholder={'[Event "Mon répertoire"]\n\n1. e4 e5 (1... c5 2. Nf3) 2. Nf3 Nc6 *'} />
              </div>
              <div>
                <button className="btn btn-primary" disabled={!paste.trim()} onClick={onPaste}>
                  <Search /> Analyser
                </button>
              </div>
            </div>
          )}
          {(tab === 'github' || tab === 'url') && IS_ARTIFACT_PREVIEW && (
            <div className="notice notice-warning" style={{ marginBottom: 14 }}>
              <AlertTriangle />
              <div>
                Cette préversion en ligne ne peut pas contacter GitHub ni d’autres sites (restriction de la page d’aperçu). Télécharge ton fichier puis importe-le depuis
                l’onglet « Fichiers » ; l’import GitHub fonctionne dans la version Netlify et dans l’application Android.
              </div>
            </div>
          )}
          {tab === 'github' && (
            <div className="stack">
              <div className="field">
                <label htmlFor="gh">Dépôt ou fichier GitHub</label>
                <div className="row">
                  <input id="gh" className="input" value={ghInput} onChange={(e) => setGhInput(e.target.value)} placeholder="propriétaire/dépôt ou URL d’un fichier .pgn" onKeyDown={(e) => e.key === 'Enter' && ghList()} />
                  <button className="btn btn-primary" onClick={ghList} disabled={!!busy}>
                    <Search /> Lister
                  </button>
                </div>
                <span className="field-hint">
                  {hasToken ? (
                    <>
                      <KeyRound size={12} /> Jeton configuré : les dépôts privés auxquels il donne accès sont lisibles.
                    </>
                  ) : (
                    <>
                      Sans jeton : dépôts publics uniquement (60 requêtes/heure). Pour un dépôt privé, ajoute un jeton en lecture seule dans{' '}
                      <Link to="/parametres#github">les réglages</Link>.
                    </>
                  )}
                </span>
              </div>
              {ghFiles && (
                <div className="card card-flat">
                  <div className="card-header">
                    <h3>
                      <FolderGit2 /> {ghFiles.owner}/{ghFiles.repo} <span className="badge">{ghFiles.ref}</span>
                      {ghFiles.private && <span className="badge badge-warning">privé</span>}
                    </h3>
                  </div>
                  {ghFiles.files.length ? (
                    <ul className="list">
                      {ghFiles.files.map((f) => (
                        <li key={f.path}>
                          <input
                            type="checkbox"
                            className="checkbox"
                            aria-label={`Sélectionner ${f.path}`}
                            checked={ghChecked.has(f.path)}
                            onChange={(e) => {
                              const n = new Set(ghChecked);
                              if (e.target.checked) n.add(f.path);
                              else n.delete(f.path);
                              setGhChecked(n);
                            }}
                          />
                          <span className="grow truncate mono">{f.path}</span>
                          <span className="small faint">{(f.size / 1024).toFixed(1)} Ko</span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="muted">Aucun fichier .pgn trouvé.</p>
                  )}
                  {ghFiles.files.length > 0 && (
                    <button className="btn btn-primary" style={{ marginTop: 12 }} disabled={!ghChecked.size || !!busy} onClick={ghImportChecked}>
                      <FileUp /> Analyser {ghChecked.size} fichier{ghChecked.size > 1 ? 's' : ''}
                    </button>
                  )}
                </div>
              )}
              <div className="notice">
                <Info />
                <div>
                  Les fichiers sont téléchargés directement de GitHub vers ton navigateur, sans serveur intermédiaire. L’application garde la référence (dépôt, chemin,
                  SHA) pour <strong>recharger</strong> le fichier plus tard et détecter s’il a changé. L’écriture vers GitHub n’est pas proposée : exporte ton PGN puis
                  pousse-le toi-même.
                </div>
              </div>
            </div>
          )}
          {tab === 'url' && (
            <div className="stack">
              <div className="field">
                <label htmlFor="url">Adresse d’un fichier PGN</label>
                <div className="row">
                  <input id="url" className="input" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…/repertoire.pgn" onKeyDown={(e) => e.key === 'Enter' && onUrl()} />
                  <button className="btn btn-primary" onClick={onUrl} disabled={!url.trim() || !!busy}>
                    <Globe /> Télécharger
                  </button>
                </div>
                <span className="field-hint">Le serveur doit autoriser les téléchargements depuis un navigateur (CORS). Sinon, télécharge le fichier et importe-le depuis ton appareil.</span>
              </div>
            </div>
          )}
        </div>
      </div>

      {busy && (
        <div className="card row" role="status">
          <Loader2 className="spin" />
          <div className="grow">
            <div>{busy.label}</div>
            {busy.total > 1 && (
              <div className="progress" style={{ marginTop: 8 }}>
                <span style={{ width: `${(busy.done / busy.total) * 100}%` }} />
              </div>
            )}
          </div>
          {busy.total > 1 && (
            <span className="small muted tabular">
              {busy.done} / {busy.total} parties
            </span>
          )}
        </div>
      )}

      {pending.length > 0 && (
        <section className="stack-lg">
          <div className="row row-between row-wrap">
            <h2>Prêt à importer</h2>
            <div className="row row-wrap">
              {folders.length > 0 && (
                <select className="select" style={{ width: 'auto' }} value={folderId} onChange={(e) => setFolderId(e.target.value)} aria-label="Dossier de destination">
                  <option value="">Sans dossier</option>
                  {folders.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.name}
                    </option>
                  ))}
                </select>
              )}
              {pending.length > 1 && (
                <button className="btn btn-primary" onClick={() => doImport(pending)}>
                  Tout importer ({pending.length})
                </button>
              )}
            </div>
          </div>
          {pending.map((p) => (
            <article className="card stack" key={p.id} data-testid="pending-import">
              <div className="row row-between row-wrap">
                <div className="field grow" style={{ minWidth: 220 }}>
                  <label htmlFor={`name-${p.id}`}>Nom du répertoire</label>
                  <input id={`name-${p.id}`} className="input" value={p.name} onChange={(e) => setPending((l) => l.map((x) => (x.id === p.id ? { ...x, name: e.target.value } : x)))} />
                  <span className="field-hint">
                    {p.fileLabel}
                    {p.encoding ? ` · ${p.encoding}` : ''} · analysé en {p.parsed.report.durationMs} ms
                  </span>
                </div>
                <div className="field">
                  <span className="field-label">Je joue</span>
                  <Segmented
                    label="Camp joué"
                    value={p.color}
                    onChange={(v) => setPending((l) => l.map((x) => (x.id === p.id ? { ...x, color: v } : x)))}
                    options={[
                      { value: 'auto', label: `Auto (${p.detected === 'w' ? 'Blancs' : 'Noirs'})` },
                      { value: 'w', label: 'Blancs' },
                      { value: 'b', label: 'Noirs' },
                    ]}
                  />
                </div>
              </div>
              {p.duplicateOf && (
                <div className="notice notice-warning">
                  <AlertTriangle />
                  <div>Ce contenu est identique au répertoire « {p.duplicateOf} » déjà importé.</div>
                </div>
              )}
              <ReportStatsGrid s={p.parsed.report} />
              <IssuesList issues={p.parsed.report.issues} max={12} />
              <div className="row row-wrap">
                <button className="btn btn-primary" onClick={() => doImport([p])} disabled={!p.parsed.games.length}>
                  <Upload /> Importer
                </button>
                <button className="btn btn-ghost" onClick={() => setPending((l) => l.filter((x) => x.id !== p.id))}>
                  <Trash2 /> Retirer
                </button>
              </div>
            </article>
          ))}
        </section>
      )}
    </div>
  );
}
