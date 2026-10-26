import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useEffect } from 'react';
import { ArrowRight, BookOpen, Clock, Flame, GitBranch, History, Play, Sparkles, Target, Upload, AlertCircle, Trophy } from 'lucide-react';
import { useLibrary } from '../state/library';
import { useSettings } from '../state/settings';
import { derive, lineMastery, masterySummary, userPositionKeys } from '../state/derived';
import { getResumableSession } from '../storage/repo';
import type { SessionState } from '../core/review/types';
import { MODE_INFO } from '../core/review/types';
import { PRESETS } from '../core/review/presets';
import { fullSelection } from '../core/repertoire/selection';
import { enumerateLines } from '../core/repertoire/lines';
import { resolveSelection } from '../core/repertoire/selection';
import { repertoireColor } from '../core/repertoire/types';
import { averageTimeMs, dailySeries, rateOf, totalThinkingMs } from '../core/stats/stats';
import { formatSan } from '../core/chess/notation';
import { EmptyState, Loading, MasteryBar, formatDuration, formatRelative, pct, toast } from '../ui/kit';
import { StackedColumns } from '../ui/charts';
import { MiniBoard, PageHeader, greeting, startSessionAndGo, useLogs } from './common';
import { importDemo } from './importHelpers';
import { MASTERY_LABELS } from '../core/srs/srs';

const DAY = 86400000;

export default function Dashboard() {
  const navigate = useNavigate();
  const { loaded, repertoires, cards, games, loadGames, error } = useLibrary();
  const settings = useSettings((s) => s.settings);
  const [resumable, setResumable] = useState<SessionState | undefined>();
  const [now] = useState(() => Date.now());
  const logs = useLogs(now - 30 * DAY);

  useEffect(() => {
    getResumableSession().then(setResumable).catch(() => undefined);
  }, []);
  useEffect(() => {
    for (const r of repertoires) if (!games[r.id]) loadGames(r.id);
  }, [repertoires, games, loadGames]);

  const summaries = useMemo(() => {
    return repertoires.map((rep) => {
      const g = games[rep.id];
      if (!g) return { rep, mastery: undefined, fragile: [] as Array<{ name: string; score: number; level: string; key: string }> };
      const d = derive(rep, g);
      const positions = userPositionKeys(rep, g, d.forest);
      const mastery = masterySummary(rep.id, positions, cards, now);
      const res = resolveSelection(d.forest, fullSelection(rep.id), rep.marks);
      const lines = enumerateLines(d.forest, res, rep.id);
      const labels = new Map(g.map((x, i) => [x.id, x.headers.find(([k]) => k === 'ChapterName')?.[1] ?? x.headers.find(([k]) => k === 'Event')?.[1] ?? `Partie ${i + 1}`]));
      const fragile = lines
        .map((l) => {
          const m = lineMastery(l, repertoireColor(rep), cards, now);
          const tail = l.steps.slice(-3).map((s) => formatSan(s.san, settings.notation)).join(' ');
          return { key: l.key, name: `${labels.get(l.gameIds[0]) ?? rep.name} · …${tail}`, score: m.score, level: m.level, touched: l.steps.some((s) => cards.has(`${rep.id}|${s.posKeyBefore}`)) };
        })
        .filter((x) => x.touched)
        .sort((a, b) => a.score - b.score)
        .slice(0, 5);
      return { rep, mastery, fragile };
    });
  }, [repertoires, games, cards, now, settings.notation]);

  const totals = useMemo(() => {
    let due = 0;
    let fresh = 0;
    let lines = 0;
    for (const s of summaries) {
      due += s.mastery?.due ?? 0;
      fresh += s.mastery?.counts.new ?? 0;
      lines += s.rep.stats.lines;
    }
    return { due, fresh, lines };
  }, [summaries]);

  const week = useMemo(() => (logs ? dailySeries(logs, 7, now) : []), [logs, now]);
  const rate7 = useMemo(() => (logs ? rateOf(logs.filter((l) => l.ts >= now - 7 * DAY)) : null), [logs, now]);
  const thinking = useMemo(() => (logs ? totalThinkingMs(logs) : 0), [logs]);
  const avg = useMemo(() => (logs ? averageTimeMs(logs) : null), [logs]);
  const recentErrors = useMemo(() => (logs ? logs.filter((l) => l.result === 'error').sort((a, b) => b.ts - a.ts).slice(0, 5) : []), [logs]);
  const fragile = useMemo(() => summaries.flatMap((s) => s.fragile.map((f) => ({ ...f, rep: s.rep }))).sort((a, b) => a.score - b.score).slice(0, 5), [summaries]);

  if (!loaded) return <Loading />;
  if (error)
    return (
      <div className="page">
        <div className="notice notice-danger">
          <AlertCircle />
          <div>
            <strong>Stockage local indisponible.</strong> {error}. Le navigateur bloque peut-être IndexedDB (navigation privée stricte ?). L’application a besoin du
            stockage local pour conserver tes répertoires.
          </div>
        </div>
      </div>
    );

  const daily = () => {
    if (totals.due + Math.min(totals.fresh, settings.newLimit) === 0) {
      toast.info('Tout est à jour', 'Aucune position n’est due aujourd’hui. Tu peux lancer une révision complète ou travailler tes erreurs.');
      return;
    }
    const cfg = PRESETS[0].build(repertoires.map((r) => fullSelection(r.id)));
    startSessionAndGo({ ...cfg, newLimit: settings.newLimit, feedback: 'immediate', onError: settings.errorPolicy, askConfidence: settings.askConfidence }, navigate);
  };

  if (!repertoires.length) {
    return (
      <div className="page page-narrow">
        <div className="hero hero-welcome">
          <div className="hero-copy">
            <div className="eyebrow">Bienvenue</div>
            <h1>Tes ouvertures, mémorisées pour de bon.</h1>
            <p>
              Importe tes propres fichiers PGN, choisis précisément les variantes à travailler et révise-les sur l’échiquier avec une répétition espacée
              qui revient sur ce que tu oublies. Et si tu te trompes… Paul aurait trouvé.
            </p>
            <div className="btn-group" style={{ marginTop: 18 }}>
              <Link to="/importer" className="btn btn-primary btn-lg">
                <Upload /> Importer mon PGN
              </Link>
              <button
                className="btn btn-lg"
                onClick={async () => {
                  const rep = await importDemo();
                  if (rep) navigate(`/repertoire/${rep.id}`);
                }}
              >
                <Sparkles /> Essayer avec la démonstration
              </button>
            </div>
            <p className="small faint" style={{ marginTop: 14 }}>
              La démonstration est un petit répertoire d’exemple, clairement identifié, que tu pourras supprimer. Tes données restent sur cet appareil.
            </p>
          </div>
          <div className="hero-board">
            <MiniBoard fen="r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R b KQkq - 3 3" orientation="w" lastMove={{ from: 'f1', to: 'c4' }} />
          </div>
        </div>
        <div className="grid grid-3">
          {[
            { icon: <Upload />, t: '1. Importe', d: 'Un ou plusieurs fichiers PGN, un texte collé ou un fichier GitHub. Variantes et commentaires sont conservés.' },
            { icon: <GitBranch />, t: '2. Sélectionne', d: 'Coche un chapitre, une variante, une sous-variante ou tout le répertoire.' },
            { icon: <Target />, t: '3. Révise', d: '10 modes de révision, une répétition espacée FSRS et des statistiques réelles.' },
          ].map((x) => (
            <div className="card" key={x.t}>
              <div className="empty-icon" style={{ width: 44, height: 44, borderRadius: 14, marginBottom: 12 }}>
                {x.icon}
              </div>
              <h3>{x.t}</h3>
              <p className="muted small" style={{ marginTop: 6 }}>
                {x.d}
              </p>
            </div>
          ))}
        </div>
      </div>
    );
  }

  const nextDue = summaries.find((s) => s.mastery && s.mastery.due > 0);
  const heroRep = nextDue?.rep ?? repertoires[0];
  const heroGames = games[heroRep.id];
  const heroTrunk = heroGames ? derive(heroRep, heroGames).trunk : null;

  return (
    <div className="page">
      <PageHeader eyebrow="Tableau de bord" title={`${greeting()} !`}>
        {totals.due > 0
          ? `${totals.due} position${totals.due > 1 ? 's' : ''} t’attend${totals.due > 1 ? 'ent' : ''} aujourd’hui.`
          : 'Aucune position n’est due : idéal pour découvrir de nouvelles lignes.'}
      </PageHeader>

      <section className="hero">
        <div className="hero-copy">
          <div className="hero-figure">
            <span className="hero-number">{totals.due}</span>
            <span className="hero-unit">
              position{totals.due > 1 ? 's' : ''} à réviser
              <small>
                + {Math.min(totals.fresh, settings.newLimit)} nouvelle{Math.min(totals.fresh, settings.newLimit) > 1 ? 's' : ''} sur {totals.fresh} à découvrir
              </small>
            </span>
          </div>
          <div className="btn-group" style={{ marginTop: 18 }}>
            <button className="btn btn-primary btn-lg" onClick={daily}>
              <Play /> Commencer ma révision
            </button>
            {resumable && (
              <Link className="btn btn-lg" to={`/session/${resumable.id}`}>
                <History /> Reprendre ma session
                <span className="badge">{MODE_INFO[resumable.config.mode].short}</span>
              </Link>
            )}
            <Link className="btn btn-lg btn-ghost" to="/session/nouvelle">
              Autres modes <ArrowRight />
            </Link>
          </div>
          <div className="preset-row">
            {PRESETS.slice(1, 5).map((p) => (
              <button
                key={p.id}
                className="chip"
                onClick={() => startSessionAndGo({ ...p.build(repertoires.map((r) => fullSelection(r.id))), onError: settings.errorPolicy }, navigate)}
              >
                {p.name}
              </button>
            ))}
          </div>
        </div>
        {heroTrunk && (
          <div className="hero-board">
            <MiniBoard fen={heroTrunk.fen} orientation={repertoireColor(heroRep)} label={`Position de départ du répertoire ${heroRep.name}`} />
            <div className="small muted truncate" style={{ marginTop: 8, textAlign: 'center' }}>
              {heroRep.name}
            </div>
          </div>
        )}
      </section>

      <section className="grid grid-4" aria-label="Indicateurs">
        <div className="card kpi">
          <span className="kpi-label">
            <BookOpen /> Répertoires
          </span>
          <span className="kpi-value">{repertoires.length}</span>
          <span className="kpi-sub">{repertoires.reduce((s, r) => s + r.stats.games, 0)} parties / chapitres</span>
        </div>
        <div className="card kpi">
          <span className="kpi-label">
            <GitBranch /> Variantes
          </span>
          <span className="kpi-value">{totals.lines}</span>
          <span className="kpi-sub">{repertoires.reduce((s, r) => s + r.stats.positions, 0)} positions</span>
        </div>
        <div className="card kpi">
          <span className="kpi-label">
            <Trophy /> Réussite (7 jours)
          </span>
          <span className="kpi-value">{pct(rate7?.rate)}</span>
          <span className="kpi-sub">{rate7?.total ? `${rate7.correct} / ${rate7.total} du premier coup` : 'Pas encore de révision'}</span>
        </div>
        <div className="card kpi">
          <span className="kpi-label">
            <Clock /> Temps de réflexion (30 j)
          </span>
          <span className="kpi-value">{formatDuration(thinking)}</span>
          <span className="kpi-sub">{avg ? `${(avg / 1000).toFixed(1)} s par bonne réponse` : 'Aucune réponse enregistrée'}</span>
        </div>
      </section>

      <section className="grid grid-2">
        <div className="card">
          <div className="card-header">
            <h2>
              <Flame /> Progression de la semaine
            </h2>
            <Link to="/statistiques" className="small">
              Statistiques détaillées
            </Link>
          </div>
          {logs == null ? (
            <div className="skeleton" style={{ height: 180 }} />
          ) : (
            <StackedColumns
              title="Réponses des 7 derniers jours"
              emptyHint
              data={week.map((d) => ({
                label: new Date(d.ts).toLocaleDateString('fr-FR', { weekday: 'short' }),
                sublabel: new Date(d.ts).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' }),
                values: { correct: d.correct, errors: d.errors },
              }))}
              series={[
                { key: 'correct', label: 'Trouvés du premier coup', color: 'var(--chart-1)' },
                { key: 'errors', label: 'Erreurs, solutions ou temps écoulé', color: 'var(--chart-2)' },
              ]}
            />
          )}
        </div>
        <div className="card">
          <div className="card-header">
            <h2>
              <Target /> Variantes les moins maîtrisées
            </h2>
          </div>
          {fragile.length ? (
            <ul className="list">
              {fragile.map((f) => (
                <li key={f.rep.id + f.key}>
                  <div className="grow">
                    <div className="truncate" style={{ fontWeight: 650 }}>
                      {f.name}
                    </div>
                    <div className="small muted">
                      {f.rep.name} · {MASTERY_LABELS[f.level as keyof typeof MASTERY_LABELS]}
                    </div>
                  </div>
                  <div className="progress" style={{ width: 90 }} aria-label={`Maîtrise ${Math.round(f.score * 100)} %`}>
                    <span style={{ width: `${f.score * 100}%` }} />
                  </div>
                  <button
                    className="btn btn-sm"
                    onClick={() =>
                      startSessionAndGo(
                        { ...PRESETS[2].build([fullSelection(f.rep.id)]), mode: 'line', lineKeys: [f.key], alternatives: 'strict', repeatAnswered: true, onError: settings.errorPolicy },
                        navigate,
                      )
                    }
                  >
                    Réviser
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState icon={<Target />} title="Pas encore de données">
              Les lignes fragiles apparaîtront ici après tes premières révisions.
            </EmptyState>
          )}
        </div>
      </section>

      <section className="grid grid-2">
        <div className="card">
          <div className="card-header">
            <h2>
              <AlertCircle /> Erreurs récentes
            </h2>
            {recentErrors.length > 0 && (
              <button
                className="btn btn-sm"
                onClick={() => startSessionAndGo({ ...PRESETS[3].build(repertoires.map((r) => fullSelection(r.id))), onError: settings.errorPolicy }, navigate)}
              >
                Réviser mes erreurs
              </button>
            )}
          </div>
          {recentErrors.length ? (
            <ul className="list">
              {recentErrors.map((e) => {
                const rep = repertoires.find((r) => r.id === e.repertoireId);
                return (
                  <li key={e.id}>
                    <span className="paul-dot" aria-hidden="true">
                      P
                    </span>
                    <div className="grow">
                      <div>
                        <span className="muted">Joué</span> <strong>{e.moveNumber}{e.color === 'w' ? '.' : '...'}{formatSan(e.playedSan ?? '?', settings.notation)}</strong>
                        <span className="muted"> · attendu </span>
                        <strong className="text-accent">{e.expectedSans.map((s) => formatSan(s, settings.notation)).join(' / ')}</strong>
                      </div>
                      <div className="small faint">
                        {rep?.name ?? 'Répertoire supprimé'} · {formatRelative(e.ts)}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : (
            <EmptyState icon={<Sparkles />} title="Aucune erreur récente">
              Rien à signaler sur les 30 derniers jours.
            </EmptyState>
          )}
        </div>
        <div className="card">
          <div className="card-header">
            <h2>
              <BookOpen /> Répertoires récents
            </h2>
            <Link to="/bibliotheque" className="small">
              Tout voir
            </Link>
          </div>
          <ul className="list">
            {summaries.slice(0, 5).map(({ rep, mastery }) => (
              <li key={rep.id}>
                <Link to={`/repertoire/${rep.id}`} className="grow list-link">
                  <div className="truncate" style={{ fontWeight: 650 }}>
                    {rep.name}
                  </div>
                  <div className="small faint">
                    {rep.stats.lines} variantes · révisé {formatRelative(rep.lastReviewedAt)}
                  </div>
                  {mastery && (
                    <div style={{ marginTop: 6 }}>
                      <MasteryBar counts={mastery.counts} total={mastery.total} />
                    </div>
                  )}
                </Link>
                {mastery && mastery.due > 0 && <span className="badge badge-warning">{mastery.due} dues</span>}
              </li>
            ))}
          </ul>
        </div>
      </section>
    </div>
  );
}
