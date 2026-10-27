import { useEffect, useMemo, useState, type ReactElement } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { BookOpen, Brain, GraduationCap, ListTree, Play, Target } from 'lucide-react';
import { useLibrary } from '../state/library';
import { useSettings } from '../state/settings';
import { useSelections } from '../state/selections';
import { fullSelection, type RepertoireSelection } from '../core/repertoire/selection';
import { defaultLength, LENGTHS, lengthUnit } from '../core/review/presets';
import { MODE_INFO, type ReviewMode } from '../core/review/types';
import { buildSessionContext } from '../core/review/context';
import { ANSWER_TIMING, buildQueue, type EngineDeps } from '../core/review/engine';
import { repertoireColor } from '../core/repertoire/types';
import { ColorDot, EmptyState, Loading, Segmented, toast } from '../ui/kit';
import { PageHeader, sessionConfig, startSessionAndGo } from './common';

const MODES: ReviewMode[] = ['smart', 'learn', 'full', 'mistakes'];

const MODE_ICONS: Record<ReviewMode, ReactElement> = {
  smart: <Brain />,
  learn: <GraduationCap />,
  full: <ListTree />,
  mistakes: <Target />,
};

const EMPTY_HINTS: Record<ReviewMode, string> = {
  smart: 'Rien à revoir aujourd’hui et aucune nouvelle position : essaie « Toute la sélection ».',
  learn: 'Aucune ligne dans la sélection.',
  full: 'Aucune ligne dans la sélection.',
  mistakes: 'Aucune erreur enregistrée pour l’instant.',
};

export default function SessionSetup() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { loaded, repertoires, games, loadGames, cards } = useLibrary();
  const settings = useSettings((s) => s.settings);
  const selStore = useSelections();
  const [picked, setPicked] = useState<Record<string, 'all' | 'working'>>({});
  const [mode, setMode] = useState<ReviewMode>('smart');
  const [length, setLength] = useState(defaultLength('smart'));
  const [busy, setBusy] = useState(false);

  // Pré-sélection depuis l'URL (?rep=…&sel=1), sinon tous les répertoires avec leur sélection de travail.
  useEffect(() => {
    if (!loaded) return;
    const rep = params.get('rep');
    if (rep && repertoires.some((r) => r.id === rep)) setPicked({ [rep]: params.get('sel') ? 'working' : 'all' });
    else if (!Object.keys(picked).length && repertoires.length) setPicked(Object.fromEntries(repertoires.map((r) => [r.id, selStore.byRep[r.id] ? 'working' : 'all'] as const)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, params]);

  useEffect(() => {
    for (const id of Object.keys(picked)) if (!games[id]) loadGames(id);
  }, [picked, games, loadGames]);

  const selections: RepertoireSelection[] = useMemo(
    () => Object.entries(picked).map(([id, scope]) => (scope === 'working' ? selStore.get(id) : fullSelection(id))),
    [picked, selStore],
  );

  // Nombre de questions (positions ou lignes) disponibles pour chaque mode.
  const available = useMemo(() => {
    const data = selections.map((s) => ({ repertoire: repertoires.find((r) => r.id === s.repertoireId)!, games: games[s.repertoireId] })).filter((d) => d.repertoire && d.games);
    if (data.length !== selections.length || !data.length) return null;
    const ctx = buildSessionContext(data as Array<{ repertoire: (typeof repertoires)[number]; games: NonNullable<(typeof games)[string]> }>, selections);
    const deps: EngineDeps = { ctx, cards, style: settings.feedbackStyle, notation: settings.notation, ...ANSWER_TIMING };
    const now = Date.now();
    return Object.fromEntries(MODES.map((m) => [m, buildQueue({ ...sessionConfig(m, selections), maxQuestions: 0 }, deps, now).length])) as Record<ReviewMode, number>;
  }, [selections, repertoires, games, cards, settings]);

  if (!loaded) return <Loading />;
  if (!repertoires.length)
    return (
      <div className="page page-narrow">
        <PageHeader eyebrow="Révision" title="Réviser" />
        <div className="card">
          <EmptyState icon={<BookOpen />} title="Aucun répertoire" action={<Link to="/importer" className="btn btn-primary">Importer un PGN</Link>}>
            Importe d’abord un PGN pour pouvoir le réviser.
          </EmptyState>
        </div>
      </div>
    );

  const kind = MODE_INFO[mode].kind;
  const count = available ? (length ? Math.min(length, available[mode]) : available[mode]) : null;
  const chooseMode = (m: ReviewMode) => {
    setMode(m);
    setLength(defaultLength(m));
  };
  const start = async () => {
    if (!selections.length) {
      toast.error('Choisis au moins un répertoire');
      return;
    }
    setBusy(true);
    await startSessionAndGo({ ...sessionConfig(mode, selections), maxQuestions: length }, navigate);
    setBusy(false);
  };

  return (
    <div className="page page-narrow">
      <PageHeader eyebrow="Révision" title="Réviser" />

      <section className="card stack" aria-labelledby="h-what">
        <h2 id="h-what">Répertoires</h2>
        <ul className="list">
          {repertoires.map((r) => {
            const working = !!selStore.byRep[r.id];
            const scope = picked[r.id];
            return (
              <li key={r.id}>
                <input
                  type="checkbox"
                  className="checkbox"
                  checked={!!scope}
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
                <div className="grow" style={{ minWidth: 0 }}>
                  <div className="row" style={{ fontWeight: 650 }}>
                    <ColorDot color={repertoireColor(r)} /> <span className="truncate">{r.name}</span>
                  </div>
                  <div className="small faint">{r.stats.lines} lignes</div>
                </div>
                {scope && working && (
                  <Segmented
                    label={`Portée pour ${r.name}`}
                    value={scope}
                    onChange={(v) => setPicked((p) => ({ ...p, [r.id]: v }))}
                    options={[
                      { value: 'working', label: 'Ma sélection', title: 'Variantes cochées dans l’explorateur' },
                      { value: 'all', label: 'Tout' },
                    ]}
                  />
                )}
                <Link className="btn btn-sm btn-ghost" to={`/repertoire/${r.id}`}>
                  Variantes
                </Link>
              </li>
            );
          })}
        </ul>
      </section>

      <section className="card stack" aria-labelledby="h-mode">
        <h2 id="h-mode">Mode</h2>
        <div className="mode-grid" role="radiogroup" aria-label="Mode de révision">
          {MODES.map((m) => (
            <button key={m} role="radio" aria-checked={mode === m} className={`mode ${mode === m ? 'is-active' : ''}`} onClick={() => chooseMode(m)}>
              <span className="row row-between" style={{ width: '100%' }}>
                <span className="mode-icon">{MODE_ICONS[m]}</span>
                {available && (
                  <span className="small muted tabular">
                    {available[m]} {lengthUnit(m, available[m])}
                  </span>
                )}
              </span>
              <span className="mode-name">{MODE_INFO[m].label}</span>
              <span className="mode-desc">{MODE_INFO[m].description}</span>
            </button>
          ))}
        </div>
        <div className="field">
          <span className="field-label">Longueur ({kind === 'lines' ? 'lignes' : 'positions'})</span>
          <Segmented
            label="Longueur de la session"
            value={String(length)}
            onChange={(v) => setLength(Number(v))}
            options={LENGTHS[kind].map((n) => ({ value: String(n), label: n ? String(n) : 'Tout' }))}
          />
        </div>
      </section>

      {available && available[mode] === 0 && <p className="small text-warning">{EMPTY_HINTS[mode]}</p>}
      <button className="btn btn-primary btn-lg btn-block" onClick={start} disabled={busy || !selections.length || count === 0}>
        <Play /> Commencer{count ? ` · ${count} ${lengthUnit(mode, count)}` : ''}
      </button>
    </div>
  );
}
