import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import {
  ArrowRight,
  BookmarkPlus,
  Check,
  Clock,
  Eye,
  Flag,
  Heart,
  Lightbulb,
  LogOut,
  NotebookPen,
  RotateCcw,
  SkipForward,
  Sparkles,
  Target,
  Trophy,
  Undo2,
  X,
  Flame,
  Keyboard,
  Maximize2,
  Minimize2,
} from 'lucide-react';
import { useReview } from '../state/review';
import { useSettings, animationsEnabled } from '../state/settings';
import { Board, type SquareMark } from '../ui/board/Board';
import * as engine from '../core/review/engine';
import { MODE_INFO, type Feedback } from '../core/review/types';
import { formatLine, formatSan, sanCandidatesFromInput } from '../core/chess/notation';
import { sideToMove } from '../core/chess/fen';
import { lineName } from '../core/repertoire/lines';
import { GRADE_LABELS, formatInterval, nextIntervalPreview, newCard, type Grade4 } from '../core/srs/srs';
import { defaultConfig } from '../core/review/presets';
import { EmptyState, Loading, formatDuration, pct, promptDialog, toast } from '../ui/kit';
import { EnginePanel } from '../ui/EnginePanel';
import { startSessionAndGo } from './common';
import type { Shape } from '../core/pgn/types';
import { PieceSvg } from '../ui/board/pieces';

export default function ReviewPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { session, deps, status, error, resume, act, updateCard, lastError, lastGraded } = useReview();
  const settings = useSettings((s) => s.settings);
  const [textMove, setTextMove] = useState('');
  const [fullscreen, setFullscreen] = useState(false);
  const [tick, setTick] = useState(0);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (id) resume(id);
  }, [id, resume]);

  const state = session?.id === id ? session : undefined;
  const phase = state?.phase;
  const item = state?.item;
  const rules = state ? engine.effectiveRules(state) : null;

  // Coups automatiques (adversaire, contexte) avec délai.
  useEffect(() => {
    if (!state || phase !== 'auto' || !item) return;
    const isContext = item.posKey !== undefined && !item.lineKey ? item.contextSteps.length > 0 : item.questionsInItem === 0 && item.moves.every((m) => m.by === 'auto');
    const delay = isContext ? settings.contextSpeedMs : settings.opponentDelayMs;
    const t = window.setTimeout(() => act({ type: 'auto' }), delay);
    return () => window.clearTimeout(t);
  }, [state, phase, item, act, settings.contextSpeedMs, settings.opponentDelayMs]);

  // Passage automatique après une bonne réponse (sessions par positions).
  useEffect(() => {
    if (!state || phase !== 'itemDone' || !settings.autoAdvanceMs) return;
    const lastUser = [...(item?.moves ?? [])].reverse().find((m) => m.by === 'user');
    const isPositions = MODE_INFO[state.config.mode].kind === 'positions';
    if (!isPositions || lastUser?.result !== 'correct') return;
    const t = window.setTimeout(() => act({ type: 'next' }), settings.autoAdvanceMs);
    return () => window.clearTimeout(t);
  }, [state, phase, item, act, settings.autoAdvanceMs]);

  // Chronomètre par coup.
  useEffect(() => {
    if (!state || phase !== 'question' || !rules?.secondsPerMove) return;
    const t = window.setInterval(() => setTick((x) => x + 1), 200);
    return () => window.clearInterval(t);
  }, [state, phase, rules?.secondsPerMove]);
  const remaining = rules?.secondsPerMove && item && phase === 'question' ? Math.max(0, rules.secondsPerMove * 1000 - (Date.now() - item.questionStartedAt)) : null;
  useEffect(() => {
    if (remaining === 0 && phase === 'question') act({ type: 'timeout' });
  }, [remaining, phase, act, tick]);

  // Raccourcis clavier.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest('input, textarea, select')) return;
      const fb = state?.feedback;
      if (e.key === 'Enter' || e.key === 'n') {
        if (phase === 'itemDone') act({ type: 'next' });
        else if (phase === 'feedback') act(fb?.kind === 'error' || fb?.kind === 'timeout' ? { type: 'continue' } : { type: 'confirm' });
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
    const line = engine.currentLine(state, deps);
    const q = phase === 'question' || phase === 'feedback' ? engine.questionInfo(state, deps) : undefined;
    const last = item.moves[item.moves.length - 1];
    return {
      fen,
      rc,
      line,
      q,
      orientation: engine.orientation(state, deps),
      userColor: engine.currentUserColor(state, deps),
      lastMove: last ? { from: last.uci.slice(0, 2), to: last.uci.slice(2, 4) } : undefined,
      lastResult: last?.by === 'user' ? last.result : undefined,
      name: rc && line ? lineName(line, rc.gameLabel, settings.notation, 5) : rc && q?.accepted[0] ? (() => {
        const node = rc.forest.byKey.get(q.accepted[0].nodeKeys[0]);
        const gid = node?.occurrences[0]?.gameId;
        return gid ? rc.gameLabel(gid) : rc.repertoire.name;
      })() : rc?.repertoire.name,
    };
  }, [state, deps, item, phase, settings.notation]);

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
  const progress = MODE_INFO[state.config.mode].kind === 'free' ? null : total ? Math.min(1, (state.cursor + (phase === 'itemDone' ? 1 : 0)) / total) : 0;
  const deferredMode = state.config.feedback === 'deferred';
  const shapes: Shape[] = [];
  if (fb?.kind === 'error' && fb.played) shapes.push({ color: 'R', from: fb.played.uci.slice(0, 2), to: fb.played.uci.slice(2, 4) });
  if ((fb?.kind === 'error' || fb?.kind === 'revealed' || fb?.kind === 'learnShow' || fb?.kind === 'timeout') && fb.expected) for (const e of fb.expected.slice(0, 3)) shapes.push({ color: 'G', from: e.uci.slice(0, 2), to: e.uci.slice(2, 4) });
  const marks: Record<string, SquareMark> = {};
  if (view.lastMove && view.lastResult && !deferredMode) marks[view.lastMove.to] = view.lastResult === 'correct' || view.lastResult === 'learned' ? 'correct' : 'wrong';
  if (fb?.kind === 'error' && fb.played && !deferredMode) marks[fb.played.uci.slice(2, 4)] = 'wrong';
  const interactive = phase === 'question';
  const turn = sideToMove(view.fen);
  const cardIdStr = view.q?.cardId ?? fb?.cardId;
  const card = cardIdStr ? deps.cards.get(cardIdStr) : undefined;

  const submitText = () => {
    const cands = sanCandidatesFromInput(textMove, settings.notation);
    for (const c of cands) {
      if (engine.resolveMove(view.fen, { san: c })) {
        act({ type: 'move', move: { san: c } });
        setTextMove('');
        return;
      }
    }
    toast.error('Coup non reconnu', `« ${textMove} » n’est pas un coup légal ici. Exemples : Cf3, e4, O-O, exd5.`);
  };

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
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => {
              act({ type: 'end' });
            }}
            aria-label="Terminer la session"
          >
            <LogOut /> Terminer
          </button>
          <div className="review-title truncate">
            <strong>{MODE_INFO[state.config.mode].label}</strong>
            {state.config.presetName && <span className="faint"> · {state.config.presetName}</span>}
          </div>
        </div>
        <div className="review-stats">
          {progress != null && (
            <span className="review-progress" aria-label={`Progression : ${state.cursor + 1} sur ${total}`}>
              <span className="tabular small">
                {Math.min(state.cursor + 1, total)}/{total}
              </span>
              <span className="progress progress-thin" style={{ width: 90 }}>
                <span style={{ width: `${(progress ?? 0) * 100}%` }} />
              </span>
            </span>
          )}
          <span className="stat-pill" title="Trouvés du premier coup">
            <Check /> {state.stats.correct}
          </span>
          <span className="stat-pill danger" title="Erreurs">
            <X /> {state.stats.errors + state.stats.timeouts}
          </span>
          {state.stats.streak >= 3 && (
            <span className="stat-pill gold" title="Série en cours">
              <Flame /> {state.stats.streak}
            </span>
          )}
          {state.config.scoring && (
            <span className="stat-pill" title="Score">
              <Trophy /> {state.stats.score}
            </span>
          )}
          {state.config.mode === 'progressive' && <span className="badge badge-violet">Niveau {state.level + 1}</span>}
          <button className="btn btn-ghost btn-icon btn-sm" onClick={toggleFullscreen} aria-label={fullscreen ? 'Quitter le plein écran' : 'Plein écran'}>
            {fullscreen ? <Minimize2 /> : <Maximize2 />}
          </button>
        </div>
      </header>

      <div className="review-body">
        <div className="review-board">
          {remaining != null && (
            <div className="move-timer" role="timer" aria-label={`Temps restant : ${Math.ceil(remaining / 1000)} secondes`}>
              <span style={{ width: `${(remaining / (rules!.secondsPerMove * 1000)) * 100}%` }} className={remaining < 3000 ? 'is-low' : ''} />
            </div>
          )}
          <Board
            fen={view.fen}
            orientation={view.orientation}
            interactive={interactive}
            movableColor={view.userColor === 'both' ? 'both' : view.userColor}
            onMove={(m) => act({ type: 'move', move: m })}
            lastMove={view.lastMove}
            shapes={shapes}
            hintSquare={item.hintSquare}
            showLegal={!!rules?.showLegal || settings.showLegal}
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
            {view.name && <div className="prompt-line truncate" title={view.name}>{view.name}</div>}
            {phase === 'question' && !fb && <p className="muted small">Trouve le coup de ton répertoire.{interactive ? ' Glisse ou clique la pièce, ou tape le coup ci-dessous.' : ''}</p>}
            {phase === 'question' && (
              <div className="row row-wrap" style={{ gap: 6 }}>
                {rules?.hints && (
                  <button className="btn btn-sm" onClick={() => act({ type: 'hint' })} disabled={!!item.hintSquare} title="Raccourci : H">
                    <Lightbulb /> Indice
                  </button>
                )}
                {(rules?.hints || state.config.onError.retry) && (
                  <button className="btn btn-sm" onClick={() => act({ type: 'reveal' })} title="Raccourci : S">
                    <Eye /> Solution
                  </button>
                )}
                {MODE_INFO[state.config.mode].kind === 'free' ? (
                  <button className="btn btn-sm btn-ghost" onClick={() => act({ type: 'takeBack' })}>
                    <Undo2 /> Annuler le coup
                  </button>
                ) : (
                  <button className="btn btn-sm btn-ghost" onClick={() => act({ type: 'skip' })} title="Passer (non compté comme réussite)">
                    <SkipForward /> Passer
                  </button>
                )}
              </div>
            )}
            {phase === 'question' && (
              <form
                className="row"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (textMove.trim()) submitText();
                }}
              >
                <div className="input-with-icon grow">
                  <Keyboard />
                  <input className="input" value={textMove} onChange={(e) => setTextMove(e.target.value)} placeholder={settings.notation === 'fr' ? 'Coup (ex. Cf3, e4, O-O)' : 'Move (e.g. Nf3, e4, O-O)'} aria-label="Saisir le coup en notation algébrique" autoComplete="off" autoCapitalize="off" />
                </div>
                <button className="btn" type="submit" disabled={!textMove.trim()}>
                  Jouer
                </button>
              </form>
            )}
          </div>

          {fb && !(deferredMode && (fb.kind === 'correct' || fb.kind === 'error')) && (
            <FeedbackCard
              fb={fb}
              phase={phase!}
              canRetry={state.config.onError.retry && fb.kind === 'error'}
              graded={state.config.graded}
              onRetry={() => act({ type: 'retry' })}
              onReveal={() => act({ type: 'reveal' })}
              onContinue={() => act(fb.kind === 'error' || fb.kind === 'timeout' ? { type: 'continue' } : { type: 'confirm' })}
              onRestart={() => act({ type: 'restart' })}
              onGrade={(g) => act({ type: 'confirm', grade: g })}
              intervals={fb.kind === 'correct' && card ? nextIntervalPreview(card, Date.now()) : fb.kind === 'correct' && cardIdStr ? nextIntervalPreview(newCard('', '', '', 'w', '', Date.now()), Date.now()) : null}
              onReviewLater={cardIdStr ? () => updateCard(cardIdStr, (c) => ({ ...c, reviewLater: true })).then(() => toast.success('Ajoutée aux révisions prioritaires')) : undefined}
              onFavorite={cardIdStr ? () => updateCard(cardIdStr, (c) => ({ ...c, favorite: !c.favorite })).then(() => toast.success(card?.favorite ? 'Retirée des favoris' : 'Position mise en favori')) : undefined}
              favorite={!!card?.favorite}
              onNote={
                cardIdStr
                  ? async () => {
                      const note = await promptDialog({ title: 'Note personnelle', label: 'Note sur cette position', defaultValue: card?.note ?? '' });
                      if (note != null) {
                        await updateCard(cardIdStr, (c) => ({ ...c, note }));
                        toast.success('Note enregistrée');
                      }
                    }
                  : undefined
              }
              style={settings.feedbackStyle}
            />
          )}
          {deferredMode && phase !== 'itemDone' && view.lastResult && <div className="card card-flat small muted">Coup enregistré. Les corrections seront affichées à la fin de la session.</div>}

          {!deferredMode && state.config.graded && lastGraded && phase !== 'feedback' && Date.now() - lastGraded.at < 120000 && (
            <div className="rating-bar card card-flat" role="group" aria-label="Noter ma dernière réponse">
              <span className="small muted">Dernière réponse notée « {GRADE_LABELS[lastGraded.grade]} ». Corriger :</span>
              <div className="row row-wrap" style={{ gap: 4 }}>
                {([1, 2, 3, 4] as Grade4[]).map((g) => (
                  <button key={g} className={`chip grade-chip g${g}`} aria-pressed={lastGraded.grade === g} onClick={() => act({ type: 'rate', cardId: lastGraded.cardId, grade: g })}>
                    {GRADE_LABELS[g]}
                  </button>
                ))}
              </div>
            </div>
          )}

          {phase === 'itemDone' && (
            <div className="card item-done">
              <div className="row row-between">
                <strong>{fb?.kind === 'lineComplete' ? fb.title : view.lastResult === 'correct' ? 'Position réussie' : 'Position terminée'}</strong>
                {fb?.kind === 'lineComplete' && <span className="small muted">{fb.message}</span>}
              </div>
              <div className="row row-wrap">
                <button className="btn btn-primary" onClick={() => act({ type: 'next' })} autoFocus>
                  {MODE_INFO[state.config.mode].kind === 'free' ? 'Nouvelle partie' : 'Suivant'} <ArrowRight />
                </button>
                <button className="btn" onClick={() => act({ type: 'restart' })}>
                  <RotateCcw /> Recommencer
                </button>
              </div>
            </div>
          )}

          {state.config.analysis && settings.engineEnabled && (phase === 'itemDone' || phase === 'feedback') && (
            <div className="card card-flat">
              <EnginePanel fen={phase === 'feedback' && view.q ? view.q.fen : view.fen} repertoireMoves={view.q?.accepted.map((m) => ({ uci: m.uci, san: m.san })) ?? []} notation={settings.notation} depth={Math.min(settings.engineDepth, 16)} autoStart compact />
            </div>
          )}

          <div className="card card-flat moves-card">
            <div className="small faint">Coups de la ligne</div>
            <div className="line-moves">
              {item.moves.length === 0 && <span className="faint small">Position de départ</span>}
              {item.moves.map((m, i) => {
                const t = sideToMove(m.fenBefore);
                const num = m.fenBefore.split(' ')[5];
                return (
                  <span key={i} className={`move-chip static ${m.by === 'user' ? 'is-user' : ''} ${m.result ? `r-${m.result}` : ''}`}>
                    {t === 'w' ? `${num}.` : i === 0 ? `${num}...` : ''}
                    {formatSan(m.san, settings.notation)}
                    {m.result === 'correct' && !deferredMode && <Check className="mv-ico" />}
                    {(m.result === 'error' || m.result === 'revealed') && !deferredMode && <X className="mv-ico" />}
                  </span>
                );
              })}
            </div>
          </div>
          <p className="tiny faint review-help">
            Raccourcis : <kbd>Entrée</kbd> continuer · <kbd>R</kbd> rejouer · <kbd>H</kbd> indice · <kbd>S</kbd> solution · <kbd>1</kbd>–<kbd>4</kbd> noter
          </p>
        </aside>
      </div>
    </div>
  );

  function Summary() {
    const st = state!.stats;
    const counted = st.correct + st.errors + st.revealed + st.timeouts;
    const elapsed = (state!.finishedAt ?? Date.now()) - state!.createdAt;
    return (
      <div className="page page-narrow">
        <div className="summary-hero">
          <div className="eyebrow">Session terminée</div>
          <h1>{counted === 0 ? 'Session terminée' : st.errors + st.timeouts + st.revealed === 0 ? 'Sans faute. Paul est jaloux.' : 'Bien travaillé !'}</h1>
          <p className="muted">
            {MODE_INFO[state!.config.mode].label} · {formatDuration(elapsed)}
          </p>
        </div>
        <div className="grid grid-4">
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
            <span className="kpi-value">{st.errors + st.timeouts}</span>
            <span className="kpi-sub">{st.revealed} solution(s) vue(s)</span>
          </div>
          <div className="card kpi">
            <span className="kpi-label">
              <Clock /> Temps moyen
            </span>
            <span className="kpi-value">{st.correct ? `${(st.answerTimeMs / st.correct / 1000).toFixed(1)} s` : '—'}</span>
            <span className="kpi-sub">par bonne réponse</span>
          </div>
          <div className="card kpi">
            <span className="kpi-label">
              <Flame /> Meilleure série
            </span>
            <span className="kpi-value">{st.bestStreak}</span>
            <span className="kpi-sub">{state!.config.scoring ? `score ${st.score}` : `${st.hints} indice(s)`}</span>
          </div>
        </div>
        {st.learned > 0 && <div className="notice notice-success"><Sparkles /><div>{st.learned} coup(s) présentés en apprentissage : ils reviendront bientôt en révision intelligente.</div></div>}
        {state!.mistakes.length > 0 && (
          <div className="card">
            <div className="card-header">
              <h2>
                <Flag /> À retravailler
              </h2>
              <button
                className="btn btn-sm btn-primary"
                onClick={() => startSessionAndGo({ ...defaultConfig('mistakes', state!.config.selections), onError: settings.errorPolicy }, navigate)}
              >
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
        {state!.deferred.length > 0 && (
          <div className="card stack">
            <h2>Corrections différées</h2>
            {state!.deferred.map((f, i) => (
              <div key={i} className="deferred-item">
                <strong>{f.title}</strong>
                <p className="small">{f.message}</p>
                {f.referenceLine && <p className="small muted">{f.referenceLine}</p>}
              </div>
            ))}
          </div>
        )}
        <div className="row row-wrap">
          <button className="btn btn-primary" onClick={() => startSessionAndGo({ ...state!.config }, navigate)}>
            <RotateCcw /> Recommencer une session identique
          </button>
          <Link className="btn" to="/session/nouvelle">
            Autre session
          </Link>
          <Link className="btn btn-ghost" to="/">
            Tableau de bord
          </Link>
          <Link className="btn btn-ghost" to="/statistiques">
            Statistiques
          </Link>
        </div>
      </div>
    );
  }
}

function FeedbackCard({
  fb,
  phase,
  canRetry,
  graded,
  onRetry,
  onReveal,
  onContinue,
  onRestart,
  onGrade,
  intervals,
  onReviewLater,
  onFavorite,
  favorite,
  onNote,
  style,
}: {
  fb: Feedback;
  phase: string;
  canRetry: boolean;
  graded: boolean;
  onRetry: () => void;
  onReveal: () => void;
  onContinue: () => void;
  onRestart: () => void;
  onGrade: (g: Grade4) => void;
  intervals: Record<Grade4, number> | null;
  onReviewLater?: () => void;
  onFavorite?: () => void;
  favorite: boolean;
  onNote?: () => void;
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
        {revealed && fb.referenceLine && <p className="small">{fb.referenceLine}</p>}
        {fb.variationName && <p className="small muted">Variante : {fb.variationName}</p>}
        {revealed && fb.explanation && (
          <blockquote className="paul-expl">
            <span className="tiny faint">Explication</span>
            {fb.explanation}
          </blockquote>
        )}
        <div className="row row-wrap small">
          {fb.severity && <span className={`badge sev-${fb.severity.level}`}>{fb.severity.text}</span>}
        </div>
        {fb.priorityNote && revealed && <p className="tiny faint">{fb.priorityNote}</p>}
        <div className="row row-wrap">
          {phase === 'feedback' && canRetry && (
            <button className="btn btn-primary" onClick={onRetry} autoFocus>
              <RotateCcw /> {revealed ? 'Rejouer la position' : 'Réessayer'}
            </button>
          )}
          {phase === 'feedback' && !revealed && (
            <button className="btn" onClick={onReveal}>
              <Eye /> Voir la solution
            </button>
          )}
          {phase === 'feedback' && (
            <button className={`btn ${canRetry ? '' : 'btn-primary'}`} onClick={onContinue} autoFocus={!canRetry}>
              Poursuivre <ArrowRight />
            </button>
          )}
          <button className="btn btn-ghost" onClick={onRestart}>
            <RotateCcw /> Recommencer la variante
          </button>
        </div>
        <div className="row row-wrap">
          {onReviewLater && (
            <button className="btn btn-sm btn-ghost" onClick={onReviewLater}>
              <BookmarkPlus /> Revoir plus tard
            </button>
          )}
          {onFavorite && (
            <button className="btn btn-sm btn-ghost" onClick={onFavorite} aria-pressed={favorite}>
              <Heart /> {favorite ? 'Favorite' : 'Favori'}
            </button>
          )}
          {onNote && (
            <button className="btn btn-sm btn-ghost" onClick={onNote}>
              <NotebookPen /> Note
            </button>
          )}
        </div>
      </section>
    );
  }
  const tone = fb.kind === 'correct' ? 'ok' : fb.kind === 'timeout' || fb.kind === 'revealed' ? 'warn' : fb.kind === 'learnShow' ? 'learn' : 'info';
  return (
    <section className={`feedback card fb-${tone}`} aria-live="polite" data-testid="feedback">
      <div className="row row-between">
        <strong className="fb-title">
          {tone === 'ok' && <Check />}
          {fb.title}
        </strong>
        {fb.kind === 'timeout' && phase === 'feedback' && (
          <button className="btn btn-sm btn-primary" onClick={onContinue}>
            Poursuivre <ArrowRight />
          </button>
        )}
      </div>
      <p className="small">{fb.message}</p>
      {fb.explanation && fb.kind !== 'correct' && <blockquote className="small muted">{fb.explanation}</blockquote>}
      {fb.kind === 'correct' && fb.explanation && <blockquote className="small muted">{fb.explanation}</blockquote>}
      {fb.kind === 'correct' && graded && intervals && phase === 'feedback' && (
        <div className="grade-row" role="group" aria-label="Noter ma réponse">
          {([1, 2, 3, 4] as Grade4[]).map((g) => (
            <button key={g} className={`grade g${g}`} onClick={() => onGrade(g)}>
              <span>{GRADE_LABELS[g]}</span>
              <small>{formatInterval(intervals[g])}</small>
            </button>
          ))}
        </div>
      )}
      {fb.kind === 'timeout' && phase === 'feedback' && canRetry === false && null}
    </section>
  );
}
