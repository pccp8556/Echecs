import { useEffect, useMemo, useState, type ReactElement } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import {
  BookOpen,
  Brain,
  Compass,
  Crosshair,
  Eye,
  EyeOff,
  GraduationCap,
  ListTree,
  Play,
  Route,
  Save,
  Shuffle,
  Swords,
  Timer,
  Trash2,
  TrendingUp,
  Target,
  Zap,
  Calendar,
  Circle,
  CircleDot,
  Sparkles,
} from 'lucide-react';
import { useLibrary } from '../state/library';
import { useSettings } from '../state/settings';
import { useSelections } from '../state/selections';
import { fullSelection, type RepertoireSelection } from '../core/repertoire/selection';
import { defaultConfig, PRESETS } from '../core/review/presets';
import { MODE_INFO, type ReviewMode, type SessionConfig } from '../core/review/types';
import { buildSessionContext } from '../core/review/context';
import { buildQueue, type EngineDeps } from '../core/review/engine';
import { lineName } from '../core/repertoire/lines';
import { gameLabelFromHeaders } from '../core/pgn/parse';
import { repertoireColor } from '../core/repertoire/types';
import { deletePreset, listPresets, savePreset } from '../storage/repo';
import type { SavedPreset } from '../storage/db';
import { newId } from '../core/repertoire/build';
import { ColorDot, EmptyState, Loading, Segmented, Switch, promptDialog, toast } from '../ui/kit';
import { PageHeader, startSessionAndGo } from './common';

const MODE_ICONS: Record<ReviewMode | 'explore', ReactElement> = {
  smart: <Brain />,
  learn: <GraduationCap />,
  blind: <EyeOff />,
  full: <ListTree />,
  critical: <Crosshair />,
  mistakes: <Target />,
  line: <Swords />,
  free: <Shuffle />,
  timed: <Timer />,
  progressive: <TrendingUp />,
  explore: <Compass />,
};

const PRESET_ICONS: Record<string, ReactElement> = {
  calendar: <Calendar />,
  zap: <Zap />,
  'list-tree': <ListTree />,
  target: <Target />,
  'circle-dot': <CircleDot />,
  circle: <Circle />,
  'eye-off': <EyeOff />,
  timer: <Timer />,
};

type Difficulty = 'easy' | 'normal' | 'hard';

function applyDifficulty(c: SessionConfig, d: Difficulty): SessionConfig {
  if (d === 'easy') return { ...c, hints: true, showLegalMoves: true, onError: { retry: true, revealAfter: 1, stopLine: false, countAsFailure: false } };
  if (d === 'hard') return { ...c, hints: false, showLegalMoves: false, onError: { retry: false, revealAfter: 0, stopLine: false, countAsFailure: true }, secondsPerMove: c.secondsPerMove || 15 };
  return { ...c, hints: true, showLegalMoves: false, onError: { retry: true, revealAfter: 0, stopLine: false, countAsFailure: true } };
}

export default function SessionSetup() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { loaded, repertoires, games, loadGames, cards } = useLibrary();
  const settings = useSettings((s) => s.settings);
  const selStore = useSelections();
  const [picked, setPicked] = useState<Record<string, 'all' | 'working'>>({});
  const [config, setConfig] = useState<SessionConfig>(() => ({ ...defaultConfig('smart', []), onError: settings.errorPolicy, newLimit: settings.newLimit, askConfidence: settings.askConfidence }));
  const [difficulty, setDifficulty] = useState<Difficulty>('normal');
  const [presets, setPresets] = useState<SavedPreset[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    listPresets().then(setPresets);
  }, []);

  // Pré-sélection depuis l'URL (?rep=…&sel=1)
  useEffect(() => {
    if (!loaded) return;
    const rep = params.get('rep');
    if (rep && repertoires.some((r) => r.id === rep)) setPicked({ [rep]: params.get('sel') ? 'working' : 'all' });
    else if (!Object.keys(picked).length && repertoires.length) setPicked(Object.fromEntries(repertoires.map((r) => [r.id, 'all' as const])));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, params]);

  useEffect(() => {
    for (const id of Object.keys(picked)) if (!games[id]) loadGames(id);
  }, [picked, games, loadGames]);

  const selections: RepertoireSelection[] = useMemo(
    () => Object.entries(picked).map(([id, mode]) => (mode === 'working' ? selStore.get(id) : fullSelection(id))),
    [picked, selStore],
  );
  const fullConfig: SessionConfig = useMemo(() => ({ ...config, selections }), [config, selections]);

  const preview = useMemo(() => {
    const data = selections.map((s) => ({ repertoire: repertoires.find((r) => r.id === s.repertoireId)!, games: games[s.repertoireId] })).filter((d) => d.repertoire && d.games);
    if (data.length !== selections.length || !data.length) return null;
    const ctx = buildSessionContext(data as Array<{ repertoire: (typeof repertoires)[number]; games: NonNullable<(typeof games)[string]> }>, selections);
    const deps: EngineDeps = { ctx, cards, style: settings.feedbackStyle, notation: settings.notation, slowMs: settings.slowMs, fastMs: settings.fastMs };
    const queue = buildQueue(fullConfig, deps, Date.now(), 'preview');
    const lines = [...ctx.reps.values()].flatMap((rc) => rc.lines.map((l) => ({ l, name: lineName(l, (gid) => { const gs = rc.games; const i = gs.findIndex((g) => g.id === gid); return i >= 0 ? gameLabelFromHeaders(gs[i].headers, i) : 'Partie'; }, settings.notation, 5) })));
    return { queue, lines };
  }, [selections, repertoires, games, cards, fullConfig, settings]);

  if (!loaded) return <Loading />;
  if (!repertoires.length)
    return (
      <div className="page page-narrow">
        <PageHeader eyebrow="Révision" title="Nouvelle session" />
        <div className="card">
          <EmptyState icon={<BookOpen />} title="Aucun répertoire" action={<Link to="/importer" className="btn btn-primary">Importer un PGN</Link>}>
            Importe d’abord un PGN pour pouvoir le réviser.
          </EmptyState>
        </div>
      </div>
    );

  const set = (patch: Partial<SessionConfig>) => setConfig((c) => ({ ...c, ...patch }));
  const setMode = (mode: ReviewMode) => {
    const base = { ...defaultConfig(mode, []), newLimit: settings.newLimit, askConfidence: settings.askConfidence };
    setConfig(applyDifficulty(mode === 'blind' || mode === 'timed' ? base : { ...base, onError: settings.errorPolicy }, difficulty));
  };
  const questions = preview?.queue.length ?? 0;
  const isLines = MODE_INFO[config.mode].kind === 'lines';
  const start = async () => {
    if (!selections.length) {
      toast.error('Choisis au moins un répertoire');
      return;
    }
    if (config.mode === 'line' && !config.lineKeys?.length) {
      toast.error('Choisis la ligne à travailler', 'Le mode « Contre une ligne » s’entraîne sur une ligne précise.');
      return;
    }
    setBusy(true);
    await startSessionAndGo(fullConfig, navigate);
    setBusy(false);
  };

  return (
    <div className="page">
      <PageHeader eyebrow="Révision" title="Préparer une session">
        Choisis ce que tu veux travailler, le mode et les règles. Tout est modifiable ; les préréglages remplissent les champs pour toi.
      </PageHeader>

      <div className="setup">
        <div className="stack-lg">
          <section className="card stack" aria-labelledby="h-what">
            <h2 id="h-what">1. Quoi réviser</h2>
            <ul className="list">
              {repertoires.map((r) => {
                const working = selStore.byRep[r.id];
                const mode = picked[r.id];
                return (
                  <li key={r.id}>
                    <input
                      type="checkbox"
                      className="checkbox"
                      checked={!!mode}
                      aria-label={`Réviser ${r.name}`}
                      onChange={(e) =>
                        setPicked((p) => {
                          const n = { ...p };
                          if (e.target.checked) n[r.id] = working ? 'working' : 'all';
                          else delete n[r.id];
                          return n;
                        })
                      }
                    />
                    <div className="grow">
                      <div className="row" style={{ fontWeight: 650 }}>
                        <ColorDot color={repertoireColor(r)} /> <span className="truncate">{r.name}</span>
                      </div>
                      <div className="small faint">{r.stats.lines} lignes · {r.stats.games} parties</div>
                    </div>
                    {mode && (
                      <Segmented
                        label={`Portée pour ${r.name}`}
                        value={mode}
                        onChange={(v) => setPicked((p) => ({ ...p, [r.id]: v }))}
                        options={[
                          { value: 'all', label: 'Tout' },
                          { value: 'working', label: working ? 'Ma sélection' : 'Sélection (tout)', title: 'Sélection faite dans l’explorateur' },
                        ]}
                      />
                    )}
                    <Link className="btn btn-sm btn-ghost" to={`/repertoire/${r.id}`}>
                      Choisir les variantes
                    </Link>
                  </li>
                );
              })}
            </ul>
            {presets.length > 0 && (
              <div className="stack-sm">
                <div className="field-label">Sessions enregistrées</div>
                <div className="row row-wrap">
                  {presets.map((p) => (
                    <span key={p.id} className="row" style={{ gap: 2 }}>
                      <button
                        className="chip"
                        onClick={() => {
                          setConfig({ ...p.config });
                          const valid = p.config.selections.filter((s) => repertoires.some((r) => r.id === s.repertoireId));
                          for (const s of valid) selStore.set(s);
                          setPicked(Object.fromEntries(valid.map((s) => [s.repertoireId, 'working' as const])));
                          savePreset({ ...p, lastUsedAt: Date.now() });
                          toast.info(`Session « ${p.name} » chargée`);
                        }}
                      >
                        <Sparkles /> {p.name}
                      </button>
                      <button
                        className="btn btn-ghost btn-icon btn-sm"
                        aria-label={`Supprimer ${p.name}`}
                        onClick={async () => {
                          await deletePreset(p.id);
                          setPresets(await listPresets());
                        }}
                      >
                        <Trash2 />
                      </button>
                    </span>
                  ))}
                </div>
              </div>
            )}
          </section>

          <section className="card stack" aria-labelledby="h-preset">
            <h2 id="h-preset">Préréglages</h2>
            <div className="preset-grid">
              {PRESETS.map((p) => (
                <button
                  key={p.id}
                  className={`preset ${config.presetName === p.name ? 'is-active' : ''}`}
                  onClick={() => {
                    const c = p.build(selections);
                    setConfig({ ...c, onError: p.id === 'nohint' ? { retry: false, revealAfter: 0, stopLine: false, countAsFailure: true } : c.mode === 'timed' ? c.onError : settings.errorPolicy, newLimit: c.mode === 'smart' ? (p.id === 'quick' ? 3 : settings.newLimit) : c.newLimit });
                  }}
                >
                  <span className="preset-icon">{PRESET_ICONS[p.icon]}</span>
                  <span className="preset-name">{p.name}</span>
                  <span className="preset-desc">{p.description}</span>
                </button>
              ))}
            </div>
          </section>

          <section className="card stack" aria-labelledby="h-mode">
            <h2 id="h-mode">2. Mode</h2>
            <div className="mode-grid" role="radiogroup" aria-label="Mode de révision">
              {(Object.keys(MODE_INFO) as Array<ReviewMode | 'explore'>).map((m) => (
                <button
                  key={m}
                  role="radio"
                  aria-checked={config.mode === m}
                  className={`mode ${config.mode === m ? 'is-active' : ''}`}
                  onClick={() => {
                    if (m === 'explore') {
                      const first = Object.keys(picked)[0] ?? repertoires[0].id;
                      navigate(`/repertoire/${first}`);
                      return;
                    }
                    setMode(m);
                  }}
                >
                  <span className="mode-icon">{MODE_ICONS[m]}</span>
                  <span className="mode-name">{MODE_INFO[m].label}</span>
                  <span className="mode-desc">{MODE_INFO[m].description}</span>
                </button>
              ))}
            </div>
            {config.mode === 'line' && preview && (
              <div className="field">
                <label htmlFor="line-pick">Ligne à travailler</label>
                <select id="line-pick" className="select" value={config.lineKeys?.[0] ?? ''} onChange={(e) => set({ lineKeys: e.target.value ? [e.target.value] : [] })}>
                  <option value="">Choisir une ligne…</option>
                  {preview.lines.map(({ l, name }) => (
                    <option key={l.key} value={l.key}>
                      {name}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </section>

          <section className="card stack" aria-labelledby="h-rules">
            <h2 id="h-rules">3. Règles</h2>
            <div className="grid grid-2">
              <div className="field">
                <span className="field-label">Couleur jouée</span>
                <Segmented
                  label="Couleur"
                  value={config.color}
                  onChange={(v) => set({ color: v })}
                  options={[
                    { value: 'auto', label: 'Du répertoire' },
                    { value: 'w', label: 'Blancs' },
                    { value: 'b', label: 'Noirs' },
                    { value: 'both', label: 'Les deux' },
                  ]}
                />
              </div>
              <div className="field">
                <span className="field-label">Difficulté</span>
                <Segmented
                  label="Difficulté"
                  value={difficulty}
                  onChange={(d) => {
                    setDifficulty(d);
                    setConfig((c) => applyDifficulty(c, d));
                  }}
                  options={[
                    { value: 'easy', label: 'Facile', title: 'Indices, coups légaux affichés, seconde chance' },
                    { value: 'normal', label: 'Normale' },
                    { value: 'hard', label: 'Difficile', title: 'Sans indice, sans seconde chance, chronomètre' },
                  ]}
                />
              </div>
              <div className="field">
                <label htmlFor="maxq">Nombre de positions (0 = toutes)</label>
                <input id="maxq" className="input" type="number" min={0} max={2000} value={config.maxQuestions} onChange={(e) => set({ maxQuestions: Math.max(0, Number(e.target.value) || 0) })} />
              </div>
              <div className="field">
                <label htmlFor="maxm">Durée maximale en minutes (0 = illimitée)</label>
                <input id="maxm" className="input" type="number" min={0} max={240} value={config.maxMinutes} onChange={(e) => set({ maxMinutes: Math.max(0, Number(e.target.value) || 0) })} />
              </div>
              <div className="field">
                <label htmlFor="order">Ordre des questions</label>
                <select id="order" className="select" value={config.order} onChange={(e) => set({ order: e.target.value as SessionConfig['order'] })}>
                  <option value="priority">Priorité (dues et fragiles d’abord)</option>
                  <option value="sequential">Ordre du répertoire</option>
                  <option value="depth">Des plus courtes aux plus longues</option>
                  <option value="random">Aléatoire</option>
                </select>
              </div>
              <div className="field">
                <label htmlFor="alts">Variantes alternatives</label>
                <select id="alts" className="select" value={config.alternatives} onChange={(e) => set({ alternatives: e.target.value as SessionConfig['alternatives'] })}>
                  <option value="follow">Acceptées : je peux jouer n’importe quel coup sélectionné</option>
                  <option value="strict">Ligne stricte : seulement le coup de la ligne étudiée</option>
                  <option value="main">Principales : seulement le coup principal</option>
                </select>
              </div>
              <div className="field">
                <label htmlFor="spm">Temps par coup en secondes (0 = sans limite)</label>
                <input id="spm" className="input" type="number" min={0} max={120} value={config.secondsPerMove} onChange={(e) => set({ secondsPerMove: Math.max(0, Number(e.target.value) || 0) })} />
              </div>
              {config.mode === 'smart' && (
                <div className="field">
                  <label htmlFor="newl">Nouvelles positions maximum</label>
                  <input id="newl" className="input" type="number" min={0} max={200} value={config.newLimit} onChange={(e) => set({ newLimit: Math.max(0, Number(e.target.value) || 0) })} />
                </div>
              )}
              <div className="field">
                <span className="field-label">Retour</span>
                <Segmented
                  label="Retour"
                  value={config.feedback}
                  onChange={(v) => set({ feedback: v })}
                  options={[
                    { value: 'immediate', label: 'Immédiat' },
                    { value: 'deferred', label: 'Différé (bilan final)' },
                  ]}
                />
              </div>
            </div>
            <div className="grid grid-2">
              <div className="stack-sm">
                <div className="field-label">Aides</div>
                <Switch checked={config.hints} onChange={(v) => set({ hints: v })} label="Indices autorisés" hint="Pièce à jouer mise en évidence, puis solution." />
                <Switch checked={config.showLegalMoves} onChange={(v) => set({ showLegalMoves: v })} label="Afficher les coups légaux" />
                <Switch checked={config.showContext} onChange={(v) => set({ showContext: v })} label="Rejouer la ligne jusqu’à la position" hint="Sinon la position est affichée directement." />
                {isLines && <Switch checked={config.askTrunk} onChange={(v) => set({ askTrunk: v })} label="Demander aussi les coups d’approche" hint="Les coups avant la sélection sont sinon joués automatiquement." />}
                {isLines && <Switch checked={config.repeatAnswered} onChange={(v) => set({ repeatAnswered: v })} label="Redemander les positions déjà réussies" hint="Utile quand plusieurs lignes partagent le même début." />}
                {settings.engineEnabled && <Switch checked={config.analysis} onChange={(v) => set({ analysis: v })} label="Analyse Stockfish après chaque réponse" hint="Facultative : n’influence jamais la correction." />}
              </div>
              <div className="stack-sm">
                <div className="field-label">En cas d’erreur</div>
                <Switch checked={config.onError.retry} onChange={(v) => set({ onError: { ...config.onError, retry: v } })} label="Autoriser une nouvelle tentative" />
                <Switch
                  checked={config.onError.revealAfter === 0}
                  onChange={(v) => set({ onError: { ...config.onError, revealAfter: v ? 0 : 1 } })}
                  label="Révéler immédiatement le coup attendu"
                  hint="Sinon une seconde chance est donnée avant la solution."
                  disabled={!config.onError.retry}
                />
                <Switch checked={config.onError.stopLine} onChange={(v) => set({ onError: { ...config.onError, stopLine: v } })} label="Interrompre la ligne" />
                <Switch checked={config.onError.countAsFailure} onChange={(v) => set({ onError: { ...config.onError, countAsFailure: v } })} label="Compter l’erreur même après correction" />
                <Switch checked={config.graded} onChange={(v) => set({ graded: v })} label="Mettre à jour la répétition espacée" hint="Désactive-le pour un entraînement sans conséquence." />
                <Switch checked={config.askConfidence} onChange={(v) => set({ askConfidence: v })} label="Demander ma confiance après chaque bonne réponse" />
                <Switch checked={config.scoring} onChange={(v) => set({ scoring: v })} label="Score (points, pénalités)" />
              </div>
            </div>
          </section>
        </div>

        <aside className="setup-summary card">
          <div className="eyebrow">Récapitulatif</div>
          <h2 className="setup-mode">
            {MODE_ICONS[config.mode]} {MODE_INFO[config.mode].label}
          </h2>
          {config.presetName && <span className="badge badge-accent">{config.presetName}</span>}
          <dl className="summary-list">
            <div>
              <dt>Répertoires</dt>
              <dd>{selections.length || '—'}</dd>
            </div>
            <div>
              <dt>{isLines ? 'Lignes' : 'Positions'}</dt>
              <dd>{preview ? (config.maxQuestions && !isLines ? Math.min(config.maxQuestions, questions) : questions) : '…'}</dd>
            </div>
            <div>
              <dt>Couleur</dt>
              <dd>{config.color === 'auto' ? 'du répertoire' : config.color === 'w' ? 'Blancs' : config.color === 'b' ? 'Noirs' : 'les deux'}</dd>
            </div>
            <div>
              <dt>Limite</dt>
              <dd>
                {config.maxQuestions ? `${config.maxQuestions} questions` : 'aucune'}
                {config.maxMinutes ? ` · ${config.maxMinutes} min` : ''}
              </dd>
            </div>
            <div>
              <dt>Aides</dt>
              <dd>
                {config.hints ? <Eye size={14} /> : <EyeOff size={14} />} {config.hints ? 'indices' : 'sans indice'}
              </dd>
            </div>
          </dl>
          {preview && questions === 0 && config.mode !== 'free' && (
            <p className="small text-warning">
              Aucune question avec ces réglages{config.mode === 'smart' ? ' : rien n’est dû et aucune nouvelle position n’est autorisée' : config.mode === 'mistakes' ? ' : pas encore d’erreur enregistrée' : ''}.
            </p>
          )}
          <button className="btn btn-primary btn-lg btn-block" onClick={start} disabled={busy || !selections.length || (questions === 0 && config.mode !== 'free')}>
            <Play /> Commencer
          </button>
          <button
            className="btn btn-block"
            onClick={async () => {
              const name = await promptDialog({ title: 'Enregistrer cette session', label: 'Nom', defaultValue: config.presetName ?? MODE_INFO[config.mode].label });
              if (!name) return;
              const t = Date.now();
              await savePreset({ id: newId(), name, config: { ...fullConfig, presetName: name }, createdAt: t, updatedAt: t });
              setPresets(await listPresets());
              toast.success('Session enregistrée', 'Elle est réutilisable avec la même sélection.');
            }}
          >
            <Save /> Enregistrer la session
          </button>
          <p className="tiny faint">
            <Route size={12} /> Les coups non sélectionnés ne sont jamais demandés ; ceux qui mènent à ta sélection sont joués automatiquement.
          </p>
        </aside>
      </div>
    </div>
  );
}
