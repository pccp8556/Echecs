import { describe, expect, it } from 'vitest';
import type { AttemptLog } from '../review/types';
import { dailySeries, frequentErrors, groupRates, rateOf, squareHeatmap, filterLogs, averageTimeMs, dueForecast } from './stats';
import { applyReview, newCard } from '../srs/srs';

const log = (p: Partial<AttemptLog>): AttemptLog => ({
  ts: Date.now(),
  sessionId: 's',
  mode: 'full',
  repertoireId: 'r',
  posKey: 'p',
  cardId: 'r|p',
  fen: 'f',
  color: 'w',
  moveNumber: 1,
  result: 'correct',
  firstTry: true,
  expectedSans: ['e4'],
  expectedUcis: ['e2e4'],
  timeMs: 2000,
  hints: 0,
  graded: true,
  ...p,
});

describe('statistiques', () => {
  it('ne compte pas les présentations ni les positions ignorées comme des réussites', () => {
    const logs = [log({}), log({ result: 'error' }), log({ result: 'learned' }), log({ result: 'revealed' })];
    const r = rateOf(logs);
    expect(r.total).toBe(3);
    expect(r.correct).toBe(1);
    expect(r.rate).toBeCloseTo(1 / 3);
    expect(rateOf([log({ result: 'learned' })]).rate).toBeNull();
  });

  it('groupe par couleur, par numéro de coup et filtre', () => {
    const logs = [log({ color: 'w', moveNumber: 1 }), log({ color: 'b', moveNumber: 7, result: 'error' }), log({ color: 'b', moveNumber: 7 })];
    const byColor = groupRates(logs, (l) => l.color);
    expect(byColor.get('b')!.rate).toBe(0.5);
    expect(groupRates(logs, (l) => l.moveNumber).get(7)!.total).toBe(2);
    expect(filterLogs(logs, { color: 'w' })).toHaveLength(1);
    expect(averageTimeMs(logs)).toBe(2000);
  });

  it('calcule séries quotidiennes, erreurs fréquentes et carte thermique', () => {
    const now = new Date(2026, 9, 26, 12).getTime();
    const logs = [
      log({ ts: now, result: 'error', playedUci: 'd2d4', playedSan: 'd4' }),
      log({ ts: now - 86400000, result: 'error', playedUci: 'd2d4', playedSan: 'd4' }),
      log({ ts: now - 86400000 }),
    ];
    const days = dailySeries(logs, 7, now);
    expect(days).toHaveLength(7);
    expect(days[6].errors).toBe(1);
    expect(days[5].total).toBe(2);
    const fe = frequentErrors(logs);
    expect(fe[0].count).toBe(2);
    expect(squareHeatmap(logs).get('e4')).toBe(2);
  });

  it('distingue la prévision des positions dues', () => {
    const now = Date.now();
    const c = applyReview(newCard('r', 'p', 'f', 'w', '', now), { grade: 3, result: 'correct', timeMs: 1, hints: 0, now, countsInStats: true });
    const f = dueForecast([c, newCard('r', 'q', 'f', 'w', '', now)], 7, now);
    expect(f.reduce((s, d) => s + d.due, 0)).toBe(1);
  });
});
