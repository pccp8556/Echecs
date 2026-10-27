import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { Activity, AlertCircle, BarChart3, Clock, Download, Flame, Grid3x3, Lightbulb, Target, TrendingUp, Trophy, CalendarClock } from 'lucide-react';
import { useLibrary } from '../state/library';
import { useSettings } from '../state/settings';
import { derive } from '../state/derived';
import { mergedPath } from '../core/repertoire/merged';
import { repertoireColor } from '../core/repertoire/types';
import { gameLabelFromHeaders } from '../core/pgn/parse';
import { formatLine, formatSan } from '../core/chess/notation';
import {
  averageTimeMs,
  calendarHeatmap,
  dailySeries,
  dueForecast,
  filterLogs,
  frequentErrors,
  groupRates,
  hintHeavy,
  masteryCounts,
  rateOf,
  squareHeatmap,
  totalThinkingMs,
  weeklySeries,
  type Rate,
} from '../core/stats/stats';
import { EmptyState, Loading, Segmented, downloadText, formatDuration, formatRelative, pct } from '../ui/kit';
import { CalendarHeat, HBars, SplitBar, StackedColumns } from '../ui/charts';
import { Board } from '../ui/board/Board';
import { MiniBoard, PageHeader, useLogs } from './common';
import type { StoredLog } from '../storage/db';

const DAY = 86400000;
type Period = '7' | '30' | '90' | '365' | 'all';

export default function StatsPage() {
  const [params] = useSearchParams();
  const { loaded, repertoires, cards, games, loadGames } = useLibrary();
  const settings = useSettings((s) => s.settings);
  const [now] = useState(() => Date.now());
  const [period, setPeriod] = useState<Period>('30');
  const [repId, setRepId] = useState<string>(params.get('rep') ?? 'all');
  const [gameId, setGameId] = useState<string>('all');
  const allLogs = useLogs();

  useEffect(() => {
    if (repId !== 'all' && !games[repId]) loadGames(repId);
  }, [repId, games, loadGames]);

  const since = period === 'all' ? undefined : now - Number(period) * DAY;
  const logs = useMemo(
    () => (allLogs ? filterLogs(allLogs, { since, repertoireId: repId === 'all' ? undefined : repId, gameId: gameId === 'all' ? undefined : gameId }) : null),
    [allLogs, since, repId, gameId],
  );
  const scopedCards = useMemo(() => [...cards.values()].filter((c) => repId === 'all' || c.repertoireId === repId), [cards, repId]);

  const heatRep = repertoires.find((r) => r.id === repId);
  const repName = (id: string) => repertoires.find((r) => r.id === id)?.name ?? 'Répertoire supprimé';
  const gameName = useMemo(() => {
    const map = new Map<string, string>();
    for (const r of repertoires) (games[r.id] ?? []).forEach((g, i) => map.set(g.id, gameLabelFromHeaders(g.headers, i)));
    return (id: string) => map.get(id) ?? 'Partie';
  }, [repertoires, games]);
  useEffect(() => {
    for (const r of repertoires) if (!games[r.id]) loadGames(r.id);
  }, [repertoires, games, loadGames]);

  const lineLabel = (repertoireId: string, lineKey: string) => {
    const rep = repertoires.find((r) => r.id === repertoireId);
    const g = games[repertoireId];
    if (!rep || !g) return lineKey;
    const d = derive(rep, g);
    const path = mergedPath(d.forest, lineKey);
    if (path.length < 2) return 'Ligne modifiée ou supprimée';
    const tail = path.slice(-3);
    const gid = path[path.length - 1].occurrences[0]?.gameId;
    return `${gid ? gameName(gid) : rep.name} · …${formatLine(tail.map((n) => n.san), path[path.length - 4]?.fen ?? path[0].fen, settings.notation).split(' ').slice(-3).join(' ')}`;
  };

  if (!loaded || !allLogs || !logs) return <Loading />;

  const rate = rateOf(logs);
  const avg = averageTimeMs(logs);
  const mc = masteryCounts(scopedCards, now);
  const days = Number(period === 'all' ? 90 : period);
  const series = days > 60 ? weeklySeries(logs, Math.ceil(days / 7), now) : dailySeries(logs, Math.max(7, days), now);
  const byColor = groupRates(logs, (l) => l.color);
  const byMove = groupRates(logs, (l) => (l.moveNumber > 25 ? 26 : l.moveNumber));
  const byRep = groupRates(logs, (l) => l.repertoireId);
  const byGame = groupRates(logs, (l) => l.gameId);
  const byLine = groupRates(logs, (l) => (l.lineKey ? `${l.repertoireId}::${l.lineKey}` : undefined));
  const fragileLines = [...byLine.entries()].filter(([, r]) => r.total >= 2 && (r.rate ?? 1) < 1).sort((a, b) => (a[1].rate ?? 0) - (b[1].rate ?? 0)).slice(0, 8);
  const errors = frequentErrors(logs, 8);
  const heat = squareHeatmap(logs);
  const forecast = dueForecast(scopedCards, 14, now);
  const hints = hintHeavy(scopedCards, 6);
  const cal = calendarHeatmap(allLogs.filter((l) => repId === 'all' || l.repertoireId === repId), 84, now).map((d) => ({ day: d.day, ts: d.ts, value: d.errors }));
  const rows = (m: Map<string | number, Rate>, label: (k: string | number) => string) =>
    [...m.entries()]
      .filter(([, r]) => r.total > 0)
      .sort((a, b) => b[1].total - a[1].total)
      .map(([k, r]) => ({ label: label(k), value: r.rate, display: pct(r.rate), detail: `${r.correct}/${r.total} du premier coup` }));

  const exportStats = (format: 'json' | 'csv') => {
    if (format === 'json') {
      downloadText(`statistiques-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify({ exportedAt: new Date().toISOString(), filters: { period, repId, gameId }, summary: rate, logs }, null, 2), 'application/json');
    } else {
      const head = 'date;repertoire;partie;couleur;coup;resultat;joue;attendu;temps_ms;indices;mode';
      const body = logs.map((l: StoredLog) =>
        [new Date(l.ts).toISOString(), repName(l.repertoireId), l.gameId ? gameName(l.gameId) : '', l.color, l.moveNumber, l.result, l.playedSan ?? '', l.expectedSans.join('/'), l.timeMs, l.hints, l.mode]
          .map((v) => `"${String(v).replace(/"/g, '""')}"`)
          .join(';'),
      );
      downloadText(`statistiques-${new Date().toISOString().slice(0, 10)}.csv`, [head, ...body].join('\n'), 'text/csv');
    }
  };

  const repGames = repId !== 'all' ? games[repId] ?? [] : [];

  return (
    <div className="page">
      <PageHeader
        eyebrow="Statistiques"
        title="Ta progression"
        actions={
          <>
            <button className="btn" onClick={() => exportStats('csv')} disabled={!logs.length}>
              <Download /> CSV
            </button>
            <button className="btn" onClick={() => exportStats('json')} disabled={!logs.length}>
              <Download /> JSON
            </button>
          </>
        }
      >
        Toutes les valeurs proviennent de tes réponses réelles. Les présentations du mode guidé et les positions passées ne sont pas comptées comme des réussites.
      </PageHeader>

      <div className="filters" role="group" aria-label="Filtres">
        <Segmented
          label="Période"
          value={period}
          onChange={setPeriod}
          options={[
            { value: '7', label: '7 j' },
            { value: '30', label: '30 j' },
            { value: '90', label: '90 j' },
            { value: '365', label: '1 an' },
            { value: 'all', label: 'Tout' },
          ]}
        />
        <select className="select" style={{ width: 'auto' }} value={repId} onChange={(e) => { setRepId(e.target.value); setGameId('all'); }} aria-label="Répertoire">
          <option value="all">Tous les répertoires</option>
          {repertoires.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </select>
        {repId !== 'all' && repGames.length > 1 && (
          <select className="select" style={{ width: 'auto', maxWidth: 260 }} value={gameId} onChange={(e) => setGameId(e.target.value)} aria-label="Variante (chapitre)">
            <option value="all">Toutes les variantes</option>
            {repGames.map((g, i) => (
              <option key={g.id} value={g.id}>
                {gameLabelFromHeaders(g.headers, i)}
              </option>
            ))}
          </select>
        )}
      </div>

      {!allLogs.length ? (
        <div className="card">
          <EmptyState icon={<BarChart3 />} title="Pas encore de statistiques" action={<Link className="btn btn-primary" to="/session/nouvelle">Commencer une révision</Link>}>
            Tes statistiques apparaîtront après ta première session. Aucune donnée n’est inventée.
          </EmptyState>
        </div>
      ) : (
        <>
          <section className="grid grid-4">
            <div className="card kpi">
              <span className="kpi-label">
                <Trophy /> Taux de réussite
              </span>
              <span className="kpi-value">{pct(rate.rate)}</span>
              <span className="kpi-sub">
                {rate.correct} / {rate.total} du premier coup
              </span>
            </div>
            <div className="card kpi">
              <span className="kpi-label">
                <Clock /> Temps moyen
              </span>
              <span className="kpi-value">{avg ? `${(avg / 1000).toFixed(1)} s` : '—'}</span>
              <span className="kpi-sub">par bonne réponse · {formatDuration(totalThinkingMs(logs))} de réflexion</span>
            </div>
            <div className="card kpi">
              <span className="kpi-label">
                <Target /> Positions maîtrisées
              </span>
              <span className="kpi-value">{mc.byLevel.mastered}</span>
              <span className="kpi-sub">{mc.byLevel.solid} solides · {mc.total} suivies</span>
            </div>
            <div className="card kpi">
              <span className="kpi-label">
                <AlertCircle /> À revoir maintenant
              </span>
              <span className="kpi-value">{mc.due}</span>
              <span className="kpi-sub">{mc.byLevel.fragile} fragiles</span>
            </div>
          </section>

          <section className="card">
            <div className="card-header">
              <h2>
                <Activity /> Évolution {days > 60 ? 'hebdomadaire' : 'quotidienne'} <span className="badge">historique</span>
              </h2>
            </div>
            <StackedColumns
              title="Réponses par période"
              data={series.map((d) => ({
                label: new Date(d.ts).toLocaleDateString('fr-FR', days > 60 ? { day: 'numeric', month: 'short' } : days > 14 ? { day: 'numeric' } : { weekday: 'short' }),
                sublabel: days > 60 ? `Semaine du ${new Date(d.ts).toLocaleDateString('fr-FR')}` : new Date(d.ts).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' }),
                values: { correct: d.correct, errors: d.errors },
              }))}
              series={[
                { key: 'correct', label: 'Trouvés du premier coup', color: 'var(--chart-1)' },
                { key: 'errors', label: 'Erreurs ou solutions vues', color: 'var(--chart-2)' },
              ]}
            />
          </section>

          <section className="grid grid-2">
            <div className="card">
              <div className="card-header">
                <h2>
                  <TrendingUp /> Par couleur
                </h2>
              </div>
              <HBars title="Taux de réussite par couleur" rows={rows(byColor as Map<string | number, Rate>, (k) => (k === 'w' ? 'Blancs' : 'Noirs'))} />
            </div>
            <div className="card">
              <div className="card-header">
                <h2>
                  <TrendingUp /> Par numéro de coup
                </h2>
              </div>
              <HBars
                title="Taux de réussite par numéro de coup"
                rows={[...byMove.entries()]
                  .sort((a, b) => Number(a[0]) - Number(b[0]))
                  .map(([k, r]) => ({ label: Number(k) > 25 ? 'Coup 26 et +' : `Coup ${k}`, value: r.rate, display: pct(r.rate), detail: `${r.correct}/${r.total}` }))}
              />
            </div>
            <div className="card">
              <div className="card-header">
                <h2>
                  <TrendingUp /> Par répertoire
                </h2>
              </div>
              <HBars title="Taux de réussite par répertoire" rows={rows(byRep as Map<string | number, Rate>, (k) => repName(String(k)))} />
            </div>
            <div className="card">
              <div className="card-header">
                <h2>
                  <TrendingUp /> Par ouverture / chapitre
                </h2>
              </div>
              <HBars title="Taux de réussite par chapitre" rows={rows(byGame as Map<string | number, Rate>, (k) => gameName(String(k))).slice(0, 12)} />
            </div>
          </section>

          <section className="grid grid-2">
            <div className="card stack">
              <div className="card-header">
                <h2>
                  <Target /> Maîtrise des positions
                </h2>
              </div>
              <SplitBar
                title="Répartition de la maîtrise"
                parts={[
                  { key: 'mastered', label: 'Maîtrisées', value: mc.byLevel.mastered, className: 'm-mastered' },
                  { key: 'solid', label: 'Solides', value: mc.byLevel.solid, className: 'm-solid' },
                  { key: 'learning', label: 'En apprentissage', value: mc.byLevel.learning, className: 'm-learning' },
                  { key: 'fragile', label: 'Fragiles', value: mc.byLevel.fragile, className: 'm-fragile' },
                ]}
              />
              <p className="small faint">« Maîtrisée » demande au moins 3 réussites et une stabilité FSRS d’au moins 21 jours.</p>
            </div>
            <div className="card">
              <div className="card-header">
                <h2>
                  <CalendarClock /> Prévision des révisions <span className="badge badge-info">prévision</span>
                </h2>
              </div>
              <StackedColumns
                title="Positions qui deviendront dues (14 prochains jours)"
                data={forecast.map((d, i) => ({ label: i === 0 ? 'auj.' : new Date(d.ts).toLocaleDateString('fr-FR', { day: 'numeric' }), sublabel: new Date(d.ts).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' }), values: { due: d.due } }))}
                series={[{ key: 'due', label: 'Positions dues (prévision FSRS)', color: 'var(--chart-3)' }]}
              />
            </div>
          </section>

          <section className="grid grid-2">
            <div className="card">
              <div className="card-header">
                <h2>
                  <Flame /> Carte thermique des erreurs (12 semaines)
                </h2>
              </div>
              <CalendarHeat days={cal} title="Erreurs par jour" valueLabel="Erreurs" />
            </div>
            <div className="card">
              <div className="card-header">
                <h2>
                  <Grid3x3 /> Cases des coups manqués
                </h2>
              </div>
              {heat.size ? (
                <div className="heat-board">
                  <Board fen="8/8/8/8/8/8/8/8 w - - 0 1" orientation={heatRep ? repertoireColor(heatRep) : 'w'} heat={heat} coordinates theme={settings.boardTheme} pieceSet={settings.pieceSet} drawable={false} label="Carte thermique des cases d’arrivée des coups manqués" />
                  <p className="small faint">Plus la case est rouge, plus tu as manqué de coups qui y arrivaient.</p>
                </div>
              ) : (
                <p className="muted small">Aucune erreur sur la période.</p>
              )}
            </div>
          </section>

          <section className="grid grid-3">
            <div className="card">
              <div className="card-header">
                <h2>
                  <AlertCircle /> Erreurs les plus fréquentes
                </h2>
              </div>
              {errors.length ? (
                <ul className="list">
                  {errors.map((e) => (
                    <li key={e.cardId + e.playedSan} className="error-item">
                      <div style={{ width: 72, flex: 'none' }}>
                        <MiniBoard fen={e.fen} orientation={e.color} />
                      </div>
                      <div className="grow small">
                        <div>
                          <span className="badge badge-danger">×{e.count}</span> joué <strong>{formatSan(e.playedSan ?? '?', settings.notation)}</strong>
                        </div>
                        <div>
                          attendu <strong className="text-accent">{e.expectedSans.map((s) => formatSan(s, settings.notation)).join(' / ')}</strong> (coup {e.moveNumber})
                        </div>
                        <div className="faint truncate">{e.gameId ? gameName(e.gameId) : repName(e.repertoireId)} · {formatRelative(e.lastTs)}</div>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="muted small">Aucune erreur sur la période.</p>
              )}
            </div>
            <div className="card">
              <div className="card-header">
                <h2>
                  <Target /> Variantes fragiles
                </h2>
              </div>
              {fragileLines.length ? (
                <HBars
                  title="Lignes au plus faible taux de réussite"
                  color="var(--chart-2)"
                  rows={fragileLines.map(([k, r]) => {
                    const [rid, lk] = k.split('::');
                    return { label: lineLabel(rid, lk), value: 1 - (r.rate ?? 0), display: pct(r.rate), detail: `${r.correct}/${r.total} du premier coup` };
                  })}
                />
              ) : (
                <p className="muted small">Il faut au moins deux réponses sur une ligne pour l’évaluer.</p>
              )}
            </div>
            <div className="card">
              <div className="card-header">
                <h2>
                  <Lightbulb /> Positions où tu demandes des indices
                </h2>
              </div>
              {hints.length ? (
                <ul className="list">
                  {hints.map((c) => (
                    <li key={c.id}>
                      <div style={{ width: 64, flex: 'none' }}>
                        <MiniBoard fen={c.fen} orientation={c.turn} />
                      </div>
                      <div className="grow small">
                        <div>
                          <strong>{c.hints}</strong> indice{c.hints > 1 ? 's' : ''} · {c.successes}/{c.attempts} réussites
                        </div>
                        <div className="faint truncate">{repName(c.repertoireId)}</div>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="muted small">Aucun indice utilisé.</p>
              )}
            </div>
          </section>
        </>
      )}
    </div>
  );
}
