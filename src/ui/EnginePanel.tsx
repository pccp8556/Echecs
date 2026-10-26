import { useEffect, useRef, useState } from 'react';
import { Cpu, Info, Play, Square } from 'lucide-react';
import { evalShare, formatEval, getEngine, pvToSan, type EngineSnapshot } from '../integrations/stockfish';
import { formatLine, type NotationStyle } from '../core/chess/notation';
import { resolveMove } from '../core/review/engine';

interface Props {
  fen: string;
  /** Coups prévus par le répertoire depuis cette position. */
  repertoireMoves?: Array<{ uci: string; san: string }>;
  notation: NotationStyle;
  depth: number;
  autoStart?: boolean;
  compact?: boolean;
}

/**
 * Analyse facultative. Le moteur informe seulement : il ne modifie jamais le
 * répertoire et n'affiche rien tant qu'il n'a pas réellement calculé.
 */
export function EnginePanel({ fen, repertoireMoves = [], notation, depth, autoStart = false, compact = false }: Props) {
  const [active, setActive] = useState(autoStart);
  const [snap, setSnap] = useState<EngineSnapshot | null>(null);
  const [status, setStatus] = useState<'idle' | 'loading' | 'running' | 'error'>('idle');
  const [error, setError] = useState<string>();
  const [repEval, setRepEval] = useState<Record<string, EngineSnapshot>>({});
  const runId = useRef(0);

  useEffect(() => {
    setSnap(null);
    setRepEval({});
    if (!active) return;
    const id = ++runId.current;
    const engine = getEngine();
    setStatus(engine.status === 'ready' ? 'running' : 'loading');
    engine
      .analyse(fen, { depth, multipv: 3 }, (s) => {
        if (runId.current !== id) return;
        setStatus('running');
        setSnap(s);
      })
      .then((s) => {
        if (runId.current === id) {
          setSnap(s);
          setStatus('idle');
        }
      })
      .catch((e) => {
        setStatus('error');
        setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      runId.current++;
    };
  }, [fen, active, depth]);

  useEffect(() => () => getEngine().stop(), []);

  const best = snap?.lines[0];
  const whiteToMove = fen.split(' ')[1] === 'w';
  const pov = (cp: number | undefined, mate: number | undefined) => {
    if (mate != null) return (whiteToMove ? 1 : -1) * (mate > 0 ? 10000 - mate : -10000 - mate);
    return (whiteToMove ? 1 : -1) * (cp ?? 0);
  };

  const evaluateRepMove = async (uci: string) => {
    const mv = resolveMove(fen, { uci });
    if (!mv) return;
    const engine = getEngine();
    const s = await engine.analyse(mv.fenAfter, { depth: Math.max(10, depth - 4), multipv: 1 }, () => undefined);
    setRepEval((r) => ({ ...r, [uci]: s }));
    // Relance l'analyse de la position courante.
    setActive(false);
    setTimeout(() => setActive(true), 0);
  };

  return (
    <div className={`engine ${compact ? 'engine-compact' : ''}`}>
      <div className="row row-between">
        <div className="row">
          <Cpu size={17} className="text-accent" />
          <strong>Analyse Stockfish 18</strong>
          {snap && snap.depth > 0 && <span className="badge">prof. {snap.depth}</span>}
          {status === 'loading' && <span className="small faint">chargement du moteur (≈ 7 Mo)…</span>}
        </div>
        <button className="btn btn-sm" onClick={() => setActive((a) => !a)} aria-pressed={active}>
          {active ? <Square /> : <Play />} {active ? 'Arrêter' : 'Analyser'}
        </button>
      </div>
      {status === 'error' && <p className="small text-danger">{error} L’analyse reste facultative : la révision fonctionne sans moteur.</p>}
      {active && !snap?.lines.length && status !== 'error' && <p className="small faint">Calcul en cours…</p>}
      {active && snap && snap.lines.length > 0 && (
        <div className="stack-sm">
          <div className="engine-eval">
            <div className="engine-evalbar" aria-hidden="true">
              <span style={{ width: `${evalShare(best) * 100}%` }} />
            </div>
            <span className="engine-score tabular">{formatEval(best)}</span>
          </div>
          <ol className="engine-lines">
            {snap.lines.map((l) => (
              <li key={l.multipv}>
                <span className="engine-line-eval tabular">{formatEval(l)}</span>
                <span className="mono small">{formatLine(pvToSan(fen, l.pv, 8), fen, notation)}</span>
              </li>
            ))}
          </ol>
          {repertoireMoves.length > 0 && (
            <div className="engine-compare">
              <div className="small faint">Comparaison avec ton répertoire</div>
              {repertoireMoves.map((m) => {
                const inTop = snap.lines.find((l) => l.pv[0] === m.uci);
                const own = repEval[m.uci]?.lines[0];
                const line = inTop ?? own;
                const label = formatLine([m.san], fen, notation);
                let verdict = '';
                if (line && best && snap.done) {
                  const loss = pov(best.cp, best.mate) - pov(line.cp, line.mate);
                  verdict = loss > 150 ? `Le moteur le juge nettement moins bon (≈ ${(loss / 100).toFixed(1)} pion).` : loss > 60 ? 'Légèrement moins précis selon le moteur.' : 'Dans la marge du meilleur coup.';
                }
                return (
                  <div key={m.uci} className="row row-wrap small">
                    <strong>{label}</strong>
                    {line ? <span className="badge">{formatEval(line)}</span> : <span className="faint">hors des 3 meilleurs coups</span>}
                    {!line && (
                      <button className="btn btn-ghost btn-sm" onClick={() => evaluateRepMove(m.uci)}>
                        Évaluer ce coup
                      </button>
                    )}
                    {verdict && <span className="muted">{verdict}</span>}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
      {!compact && (
        <p className="small faint row" style={{ alignItems: 'flex-start' }}>
          <Info size={14} style={{ flex: 'none', marginTop: 3 }} />
          <span>
            Une <strong>erreur de répertoire</strong> est un coup différent de ton PGN ; une <strong>erreur échiquéenne</strong> est un coup objectivement faible selon le
            moteur. Ce sont deux notions distinctes : l’analyse n’est qu’une information et ne modifie jamais tes lignes.
          </span>
        </p>
      )}
    </div>
  );
}
