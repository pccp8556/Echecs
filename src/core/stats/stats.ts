import type { Color } from '../chess/fen';
import type { AttemptLog } from '../review/types';
import { isDue, masteryOf, type MasteryLevel, type ReviewCard } from '../srs/srs';

/** Résultats qui comptent dans le taux de réussite (les présentations et alternatives sont exclues). */
export const COUNTED: ReadonlyArray<AttemptLog['result']> = ['correct', 'error', 'revealed', 'timeout'];

export interface StatsFilter {
  since?: number;
  until?: number;
  color?: Color;
  repertoireId?: string;
  gameId?: string;
  lineKey?: string;
}

export function filterLogs<T extends AttemptLog>(logs: T[], f: StatsFilter): T[] {
  return logs.filter(
    (l) =>
      (f.since == null || l.ts >= f.since) &&
      (f.until == null || l.ts <= f.until) &&
      (!f.color || l.color === f.color) &&
      (!f.repertoireId || l.repertoireId === f.repertoireId) &&
      (!f.gameId || l.gameId === f.gameId) &&
      (!f.lineKey || l.lineKey === f.lineKey),
  );
}

export interface Rate {
  total: number;
  correct: number;
  errors: number;
  revealed: number;
  timeouts: number;
  rate: number | null;
}

export function rateOf(logs: AttemptLog[]): Rate {
  const counted = logs.filter((l) => COUNTED.includes(l.result));
  const correct = counted.filter((l) => l.result === 'correct').length;
  return {
    total: counted.length,
    correct,
    errors: counted.filter((l) => l.result === 'error').length,
    revealed: counted.filter((l) => l.result === 'revealed').length,
    timeouts: counted.filter((l) => l.result === 'timeout').length,
    rate: counted.length ? correct / counted.length : null,
  };
}

export function groupRates<K extends string | number>(logs: AttemptLog[], key: (l: AttemptLog) => K | undefined): Map<K, Rate> {
  const groups = new Map<K, AttemptLog[]>();
  for (const l of logs) {
    const k = key(l);
    if (k === undefined) continue;
    const g = groups.get(k);
    if (g) g.push(l);
    else groups.set(k, [l]);
  }
  const out = new Map<K, Rate>();
  for (const [k, g] of groups) out.set(k, rateOf(g));
  return out;
}

export function averageTimeMs(logs: AttemptLog[]): number | null {
  const ok = logs.filter((l) => l.result === 'correct' && l.timeMs > 0);
  if (!ok.length) return null;
  return ok.reduce((s, l) => s + Math.min(l.timeMs, 120000), 0) / ok.length;
}

/** Temps passé à réfléchir (chaque réponse plafonnée à 2 minutes pour ignorer les pauses). */
export function totalThinkingMs(logs: AttemptLog[]): number {
  return logs.reduce((s, l) => s + Math.min(Math.max(0, l.timeMs), 120000), 0);
}

export function dayKey(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function startOfDay(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export interface DayPoint {
  day: string;
  ts: number;
  total: number;
  correct: number;
  errors: number;
}

export function dailySeries(logs: AttemptLog[], days: number, now: number): DayPoint[] {
  const start = startOfDay(now) - (days - 1) * 86400000;
  const points: DayPoint[] = [];
  for (let i = 0; i < days; i++) {
    const ts = start + i * 86400000;
    // Les changements d'heure peuvent décaler : on recalcule le début du jour.
    const t = startOfDay(ts + 3600000);
    points.push({ day: dayKey(t), ts: t, total: 0, correct: 0, errors: 0 });
  }
  const byDay = new Map(points.map((p) => [p.day, p]));
  for (const l of logs) {
    if (!COUNTED.includes(l.result)) continue;
    const p = byDay.get(dayKey(l.ts));
    if (!p) continue;
    p.total++;
    if (l.result === 'correct') p.correct++;
    else p.errors++;
  }
  return points;
}

export function weeklySeries(logs: AttemptLog[], weeks: number, now: number): DayPoint[] {
  const days = dailySeries(logs, weeks * 7, now);
  const out: DayPoint[] = [];
  for (let w = 0; w < weeks; w++) {
    const slice = days.slice(w * 7, w * 7 + 7);
    out.push({
      day: slice[0].day,
      ts: slice[0].ts,
      total: slice.reduce((s, d) => s + d.total, 0),
      correct: slice.reduce((s, d) => s + d.correct, 0),
      errors: slice.reduce((s, d) => s + d.errors, 0),
    });
  }
  return out;
}

export interface FrequentError {
  cardId: string;
  repertoireId: string;
  fen: string;
  playedSan?: string;
  expectedSans: string[];
  count: number;
  lastTs: number;
  gameId?: string;
  moveNumber: number;
  color: Color;
}

export function frequentErrors(logs: AttemptLog[], limit = 10): FrequentError[] {
  const map = new Map<string, FrequentError>();
  for (const l of logs) {
    if (l.result !== 'error') continue;
    const k = `${l.cardId}|${l.playedUci ?? ''}`;
    const e = map.get(k);
    if (e) {
      e.count++;
      e.lastTs = Math.max(e.lastTs, l.ts);
    } else
      map.set(k, {
        cardId: l.cardId,
        repertoireId: l.repertoireId,
        fen: l.fen,
        playedSan: l.playedSan,
        expectedSans: l.expectedSans,
        count: 1,
        lastTs: l.ts,
        gameId: l.gameId,
        moveNumber: l.moveNumber,
        color: l.color,
      });
  }
  return [...map.values()].sort((a, b) => b.count - a.count || b.lastTs - a.lastTs).slice(0, limit);
}

/** Erreurs par case d'arrivée du coup attendu (carte thermique sur l'échiquier). */
export function squareHeatmap(logs: AttemptLog[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const l of logs) {
    if (l.result !== 'error' && l.result !== 'timeout' && l.result !== 'revealed') continue;
    const sq = l.expectedUcis[0]?.slice(2, 4);
    if (sq) out.set(sq, (out.get(sq) ?? 0) + 1);
  }
  return out;
}

/** Erreurs par jour (calendrier). */
export function calendarHeatmap(logs: AttemptLog[], days: number, now: number): DayPoint[] {
  return dailySeries(logs, days, now);
}

export interface MasteryCounts {
  total: number;
  byLevel: Record<MasteryLevel, number>;
  due: number;
}

export function masteryCounts(cards: ReviewCard[], now: number): MasteryCounts {
  const byLevel: Record<MasteryLevel, number> = { new: 0, learning: 0, fragile: 0, solid: 0, mastered: 0 };
  let due = 0;
  for (const c of cards) {
    if (c.obsolete) continue;
    byLevel[masteryOf(c, now)]++;
    if (isDue(c, now)) due++;
  }
  return { total: cards.filter((c) => !c.obsolete).length, byLevel, due };
}

/** Prévision : positions qui deviendront dues chaque jour (à ne pas confondre avec l'historique). */
export function dueForecast(cards: ReviewCard[], days: number, now: number): Array<{ day: string; ts: number; due: number }> {
  const start = startOfDay(now);
  const out = Array.from({ length: days }, (_, i) => {
    const ts = startOfDay(start + i * 86400000 + 3600000);
    return { day: dayKey(ts), ts, due: 0 };
  });
  for (const c of cards) {
    if (c.obsolete || c.fsrs.state === 0) continue;
    const idx = c.fsrs.due <= now ? 0 : Math.floor((startOfDay(c.fsrs.due) - start) / 86400000);
    if (idx >= 0 && idx < days) out[idx].due++;
  }
  return out;
}

export function hintHeavy(cards: ReviewCard[], limit = 8): ReviewCard[] {
  return cards
    .filter((c) => !c.obsolete && c.hints > 0)
    .sort((a, b) => b.hints - a.hints)
    .slice(0, limit);
}
