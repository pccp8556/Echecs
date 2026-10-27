import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { ArrowRight, Check, Clock, Eye, Flag, Lightbulb, LogOut, Maximize2, Minimize2, RotateCcw, Sparkles, Target, X } from 'lucide-react';
import { useReview } from '../state/review';
import { useSettings, animationsEnabled } from '../state/settings';
import { Board, type SquareMark } from '../ui/board/Board';
import * as engine from '../core/review/engine';
import { MODE_INFO, type Feedback } from '../core/review/types';
import { formatLine, formatSan } from '../core/chess/notation';
import { sideToMove } from '../core/chess/fen';
import { GRADE_LABELS, formatInterval, nextIntervalPreview, newCard, type Grade4 } from '../core/srs/srs';
import { EmptyState, Loading, formatDuration, pct } from '../ui/kit';
import { sessionConfig, startSessionAndGo } from './common';
import type { Shape } from '../core/pgn/types';
import { PieceSvg } from '../ui/board/pieces';

/** Délai avant le coup adverse, relecture de la position, passage automatique après une bonne réponse (ms). */
const OPPONENT_DELAY_MS = 450;
const CONTEXT_SPEED_MS = 140;
const AUTO_ADVANCE_MS = 900;

export default function ReviewPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { session, deps, status, error, resume, act, lastError } = useReview();
  const settings = useSettings((s) => s.settings);
  const [fullscreen, setFullscreen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (id) resume(id);
  }, [id, resume]);

  const state = session?.id === id ? session : undefined;
  const phase = state?.phase;
  const item = state?.item;

  // Coups automatiques (adversaire, contexte) avec délai.
  useEffect(() => {
    if (!state || phase !== 'auto' || !item) return;
    const isContext = item.posKey !== undefined && !item.lineKey ? item.contextSteps.length > 0 : item.questionsInItem === 0 && item.moves.every((m) => m.by === 'auto');
    const t = window.setTimeout(() => act({ type: 'auto' }), isContext ? CONTEXT_SPEED_MS : OPPONENT_DELAY_MS);
    return () => window.clearTimeout(t);
  }, [state, phase, item, act]);

  // Passage automatique après une bonne réponse (sessions par positions).
  useEffect(() => {
    if (!state || phase !== 'itemDone') return;
    const lastUser = [...(item?.moves ?? [])].reverse().find((m) => m.by === 'user');
    if (MODE_INFO[state.config.mode].kind !== 'positions' || lastUser?.result !== 'correct') return;
    const t = window.setTimeout(() => act({ type: 'next' }), AUTO_ADVANCE_MS);
    return () => window.clearTimeout(t);
  }, [state, phase, item, act]);

  // Raccourcis clavier.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest('input, textarea, select')) return;
      const fb = state?.feedback;
      if (e.key === 'Enter' || e.key === 'n') {
        if (phase === 'itemDone') act({ type: 'next' });
        else if (phase === 'feedback') act(fb?.kind === 'error' ? { type: 'continue' } : { type: 'confirm' });
      } else if (e.key === 'r' && phase === 'feedback') act({ type: 'retry' });
      else if (e.key === 'h' && phase === 'question') act({ type: 'hint' });
      else if (e.key === 's' && (phase === 'question' || phase === 'feedback')) act({ type: 'reveal' });
      else if (['1', '2', '3', '4'].includes(e.key) && phase === 'feedback' && fb?.kind === 'correct') act({ type: 'confirm', grade: Number(e.key) as Grade4 });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [phase, state?.feedback, act]);

  useEffect(() => {
    const onFs = () => setFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onFs);
    return () => document.removeEventListener('fullscreenchange', onFs);
  }, []);

  const view = useMemo(() => {
    if (!state || !deps || !item) return null;
    const fen = engine.currentFen(state);
    const rc = engine.currentRep(state, deps);
    const last = item.moves[item.moves.length - 1];
    return {
      fen,
      repName: rc?.repertoire.name,
      // Le nom de la ligne ou du chapitre contient souvent les coups attendus : il n'est montré qu'une fois l'élément terminé.
      label: phase === 'itemDone' ? engine.itemLabel(state, deps) : undefined,
      cardId: phase === 'question' || phase === 'feedback' ? engine.questionInfo(state, deps)?.cardId : undefined,
      userColor: engine.currentUserColor(state, deps),
      lastMove: last ? { from: last.uci.slice(0, 2), to: last.uci.slice(2, 4) } : undefined,
      lastResult: last?.by === 'user' ? last.result : undefined,
    };
  }, [state, deps, item, phase]);

  if (status === 'loading' || (status === 'idle' && !state)) return <Loading label="Préparation de la session…" />;
  if (status === 'error' || !state || !deps)
    return (
      <div className="page page-narrow">
        <EmptyState icon={<X />} title="Session indisponible" action={<Link className="btn btn-primary" to="/session/nouvelle">Nouvelle session</Link>}>
          {error ?? 'Cette session n’existe plus.'}
        </EmptyState>
      </div>
    );

  if (phase === 'finished') return <Summary />;
  if (!view || !item) return <Loading />;

  const fb = state.feedback;
  const total = state.queue.length;
  const progress = total ? Math.min(1, (state.cursor + (phase === 'itemDone' ? 1 : 0)) / total) : 0;
  const shapes: Shape[] = [];
  if (fb?.kind === 'error' && fb.played) shapes.push({ color: 'R', from: fb.played.uci.slice(0, 2), to: fb.played.uci.slice(2, 4) });
  if ((fb?.kind === 'error' || fb?.kind === 'revealed' || fb?.kind === 'learnShow') && fb.expected) for (const e of fb.expected.slice(0, 3)) shapes.push({ color: 'G', from: e.uci.slice(0, 2), to: e.uci.slice(2, 4) });
  const marks: Record<string, SquareMark> = {};
  if (view.lastMove && view.lastResult) marks[view.lastMove.to] = view.lastResult === 'correct' || view.lastResult === 'learned' ? 'correct' : 'wrong';
  if (fb?.kind === 'error' && fb.played) marks[fb.played.uci.slice(2, 4)] = 'wrong';
  const turn = sideToMove(view.fen);
  const cardIdStr = view.cardId ?? fb?.cardId;
  const card = cardIdStr ? deps.cards.get(cardIdStr) : undefined;

  const toggleFullscreen = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await wrapRef.current?.requestFullscreen();
    } catch {
      /* non pris en charge */
    }
  };

  return (
    <div className="review" ref={wrapRef}>
      <header className="review-top">
        <div className="row grow" style={{ minWidth: 0 }}>
          <button className="btn btn-ghost btn-sm" onClick={() => act({ type: 'end' })} aria-label="Terminer la session">
            <LogOut /> Terminer
          </button>
          <div className="review-title truncate">
            <strong>{MODE_INFO[state.config.mode].label}</strong>
          </div>
        </div>
        <div className="review-stats">
          <span className="review-progress" aria-label={`Progression : ${state.cursor + 1} sur ${total}`}>
            <span className="tabular small">
              {Math.min(state.cursor + 1, total)}/{total}
            </span>
            <span className="progress progress-thin" style={{ width: 90 }}>
              <span style={{ width: `${progress * 100}%` }} />
            </span>
          </span>
          <span className="stat-pill" title="Trouvés du premier coup">
            <Check /> {state.stats.correct}
          </span>
          <span className="stat-pill danger" title="Erreurs">
            <X /> {state.stats.errors}
          </span>
          <button className="btn btn-ghost btn-icon btn-sm" onClick={toggleFullscreen} aria-label={fullscreen ? 'Quitter le plein écran' : 'Plein écran'}>
            {fullscreen ? <Minimize2 /> : <Maximize2 />}
          </button>
        </div>
      </header>

      <div className="review-body">
        <div className="review-board">
          <Board
            fen={view.fen}
            orientation={view.userColor}
            interactive={phase === 'question'}
            movableColor={view.userColor}
            onMove={(m) => act({ type: 'move', move: m })}
            lastMove={view.lastMove}
            shapes={shapes}
            hintSquare={item.hintSquare}
            coordinates={settings.coordinates}
            marks={marks}
            theme={settings.boardTheme}
            pieceSet={settings.pieceSet}
            animate={animationsEnabled(settings)}
            shake={fb?.kind === 'error' ? lastError : undefined}
            label="Échiquier de révision"
            drawable
          />
        </div>

        <aside className="review-panel">
          <div className="prompt card">
            <div className="row row-between">
              <span className={`turn-badge ${turn}`}>
                <span className="turn-piece">
                  <PieceSvg set={settings.pieceSet} piece={`${turn}k`} />
                </span>
                {phase === 'auto' ? (item.moves.length === 0 ? 'Mise en place…' : 'Coup adverse…') : phase === 'question' ? `À toi — ${turn === 'w' ? 'Blancs' : 'Noirs'}` : phase === 'itemDone' ? 'Terminé' : 'Correction'}
              </span>
              {card && card.attempts > 0 && <span className="tiny faint">{pct(card.successes / card.attempts)} de réussite ici</span>}
            </div>
            {(view.label ?? view.repName) && (
              <div className="prompt-line truncate" title={view.label ?? view.repName}>
                {view.label ?? view.repName}
              </div>
            )}
            {phase === 'question' && !fb && <p className="muted small">Trouve le coup de ton répertoire : glisse ou clique la pièce.</p>}
            {phase === 'question' && (
              <div className="row row-wrap" style={{ gap: 6 }}>
                <button className="btn btn-sm" onClick={() => act({ type: 'hint' })} disabled={!!item.hintSquare} title="Raccourci : H">
                  <Lightbulb /> Indice
                </button>
                <button className="btn btn-sm" onClick={() => act({ type: 'reveal' })} title="Raccourci : S">
                  <Eye /> Solution
                </button>
              </div>
            )}
          </div>

          {fb && (
            <FeedbackCard
              fb={fb}
              phase={phase!}
              onRetry={() => act({ type: 'retry' })}
              onReveal={() => act({ type: 'reveal' })}
              onContinue={() => act(fb.kind === 'error' ? { type: 'continue' } : { type: 'confirm' })}
              onGrade={(g) => act({ type: 'confirm', grade: g })}
              intervals={fb.kind === 'correct' && phase === 'feedback' ? nextIntervalPreview(card ?? newCard('', '', '', 'w', '', Date.now()), Date.now()) : null}
              style={settings.feedbackStyle}
            />
          )}

          {phase === 'itemDone' && (
            <div className="card item-done">
              <div className="row row-between">
                <strong>{fb?.kind === 'lineComplete' ? fb.title : view.lastResult === 'correct' ? 'Position réussie' : 'Position terminée'}</strong>
                {fb?.kind === 'lineComplete' && <span className="small muted">{fb.message}</span>}
              </div>
              <div className="row row-wrap">
                <button className="btn btn-primary" onClick={() => act({ type: 'next' })} autoFocus>
                  Suivant <ArrowRight />
                </button>
                <button className="btn" onClick={() => act({ type: 'restart' })}>
                  <RotateCcw /> Recommencer
                </button>
              </div>
            </div>
          )}

          <div className="card card-flat moves-card">
            <div className="small faint">Coups joués</div>
            <div className="line-moves">
              {item.moves.length === 0 && <span className="faint small">Position de départ</span>}
              {item.moves.map((m, i) => {
                const t = sideToMove(m.fenBefore);
                const num = m.fenBefore.split(' ')[5];
                return (
                  <span key={i} className={`move-chip static ${m.by === 'user' ? 'is-user' : ''} ${m.result ? `r-${m.result}` : ''}`}>
                    {t === 'w' ? `${num}.` : i === 0 ? `${num}...` : ''}
                    {formatSan(m.san, settings.notation)}
                    {m.result === 'correct' && <Check className="mv-ico" />}
                    {(m.result === 'error' || m.result === 'revealed') && <X className="mv-ico" />}
                  </span>
                );
              })}
            </div>
          </div>
          <p className="tiny faint review-help">
            Raccourcis : <kbd>Entrée</kbd> continuer · <kbd>R</kbd> rejouer · <kbd>H</kbd> indice · <kbd>S</kbd> solution
          </p>
        </aside>
      </div>
    </div>
  );

  function Summary() {
    const st = state!.stats;
    const counted = st.correct + st.errors + st.revealed;
    const elapsed = (state!.finishedAt ?? Date.now()) - state!.createdAt;
    return (
      <div className="page page-narrow">
        <div className="summary-hero">
          <div className="eyebrow">Session terminée</div>
          <h1>{counted === 0 ? 'Session terminée' : st.errors + st.revealed === 0 ? 'Sans faute. Paul est jaloux.' : 'Bien travaillé !'}</h1>
          <p className="muted">
            {MODE_INFO[state!.config.mode].label} · {formatDuration(elapsed)}
          </p>
        </div>
        <div className="grid grid-3">
          <div className="card kpi">
            <span className="kpi-label">
              <Target /> Réussite
            </span>
            <span className="kpi-value">{pct(counted ? st.correct / counted : null)}</span>
            <span className="kpi-sub">
              {st.correct}/{counted} du premier coup
            </span>
          </div>
          <div className="card kpi">
            <span className="kpi-label">
              <X /> Erreurs
            </span>
            <span className="kpi-value">{st.errors}</span>
            <span className="kpi-sub">{st.revealed} solution(s) vue(s)</span>
          </div>
          <div className="card kpi">
            <span className="kpi-label">
              <Clock /> Temps moyen
            </span>
            <span className="kpi-value">{st.correct ? `${(st.answerTimeMs / st.correct / 1000).toFixed(1)} s` : '—'}</span>
            <span className="kpi-sub">par bonne réponse</span>
          </div>
        </div>
        {st.learned > 0 && (
          <div className="notice notice-success">
            <Sparkles />
            <div>{st.learned} coup(s) présentés : ils reviendront bientôt dans la révision du jour.</div>
          </div>
        )}
        {state!.mistakes.length > 0 && (
          <div className="card">
            <div className="card-header">
              <h2>
                <Flag /> À retravailler
              </h2>
              <button className="btn btn-sm btn-primary" onClick={() => startSessionAndGo(sessionConfig('mistakes', state!.config.selections), navigate)}>
                Revoir mes erreurs
              </button>
            </div>
            <ul className="list">
              {state!.mistakes.map((m, i) => (
                <li key={i}>
                  <span className="paul-dot" aria-hidden="true">
                    P
                  </span>
                  <div className="grow">
                    <div>
                      {m.played ? (
                        <>
                          Joué <strong>{formatLine([m.played], m.fen, settings.notation)}</strong> ·{' '}
                        </>
                      ) : null}
                      attendu <strong className="text-accent">{m.expected.join(' / ')}</strong>
                    </div>
                    <div className="small faint truncate">{m.label}</div>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}
        <div className="row row-wrap">
          <Link className="btn btn-primary" to="/session/nouvelle">
            Nouvelle session
          </Link>
          <Link className="btn btn-ghost" to="/">
            Accueil
          </Link>
        </div>
      </div>
    );
  }
}

function FeedbackCard({
  fb,
  phase,
  onRetry,
  onReveal,
  onContinue,
  onGrade,
  intervals,
  style,
}: {
  fb: Feedback;
  phase: string;
  onRetry: () => void;
  onReveal: () => void;
  onContinue: () => void;
  onGrade: (g: Grade4) => void;
  intervals: Record<Grade4, number> | null;
  style: string;
}) {
  if (fb.kind === 'error') {
    const revealed = !!fb.expected;
    return (
      <section className={`paul card paul-${style}`} role="alert" aria-live="assertive" data-testid="paul-feedback">
        <div className="paul-head">
          <span className="paul-avatar" aria-hidden="true">
            P
          </span>
          <div>
            <h2 className="paul-title">{fb.title}</h2>
            {fb.quip && <p className="paul-quip">{fb.quip}</p>}
          </div>
        </div>
        <p className="paul-msg">{fb.message}</p>
        {revealed && (
          <div className="paul-moves">
            <span className="mv-played">
              <X /> Joué : {fb.played?.label}
            </span>
            <span className="mv-expected">
              <Check /> Attendu : {fb.expected!.map((e) => e.label).join(' / ')}
            </span>
          </div>
        )}
        {revealed && fb.explanation && (
          <blockquote className="paul-expl">
            <span className="tiny faint">Explication</span>
            {fb.explanation}
          </blockquote>
        )}
        {fb.severity && (
          <div className="row row-wrap small">
            <span className={`badge sev-${fb.severity.level}`}>{fb.severity.text}</span>
          </div>
        )}
        {phase === 'feedback' && (
          <div className="row row-wrap">
            <button className="btn btn-primary" onClick={onRetry} autoFocus>
              <RotateCcw /> {revealed ? 'Rejouer la position' : 'Réessayer'}
            </button>
            {!revealed && (
              <button className="btn" onClick={onReveal}>
                <Eye /> Voir la solution
              </button>
            )}
            <button className="btn" onClick={onContinue}>
              Poursuivre <ArrowRight />
            </button>
          </div>
        )}
      </section>
    );
  }
  const tone = fb.kind === 'correct' ? 'ok' : fb.kind === 'revealed' ? 'warn' : fb.kind === 'learnShow' ? 'learn' : 'info';
  return (
    <section className={`feedback card fb-${tone}`} aria-live="polite" data-testid="feedback">
      <strong className="fb-title">
        {tone === 'ok' && <Check />}
        {fb.title}
      </strong>
      <p className="small">{fb.message}</p>
      {fb.explanation && <blockquote className="small muted">{fb.explanation}</blockquote>}
      {fb.kind === 'correct' && intervals && (
        <div className="grade-row" role="group" aria-label="Noter ma réponse">
          {([1, 2, 3, 4] as Grade4[]).map((g) => (
            <button key={g} className={`grade g${g}`} onClick={() => onGrade(g)}>
              <span>{GRADE_LABELS[g]}</span>
              <small>{formatInterval(intervals[g])}</small>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
