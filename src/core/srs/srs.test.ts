import { describe, expect, it } from 'vitest';
import { applyReview, autoGrade, isDue, masteryOf, newCard, priority, resetScheduling, type ReviewCard } from './srs';

const DAY = 86400000;
const review = (c: ReviewCard, grade: 1 | 2 | 3 | 4, now: number, result: 'correct' | 'error' = grade === 1 ? 'error' : 'correct') =>
  applyReview(c, { grade, result, timeMs: 3000, hints: 0, now, countsInStats: true });

describe('répétition espacée (FSRS)', () => {
  it('espace progressivement les révisions réussies', () => {
    let c = newCard('r', 'p', 'fen', 'w', 'e2e4', 0);
    let now = 0;
    const intervals: number[] = [];
    for (let i = 0; i < 5; i++) {
      c = review(c, 3, now);
      intervals.push(c.fsrs.due - now);
      now = c.fsrs.due;
    }
    for (let i = 2; i < intervals.length; i++) expect(intervals[i]).toBeGreaterThan(intervals[i - 1]);
    expect(intervals.at(-1)!).toBeGreaterThan(5 * DAY);
  });

  it('ne considère pas une position maîtrisée après une seule réussite', () => {
    let c = newCard('r', 'p', 'fen', 'w', 'e2e4', 0);
    c = review(c, 4, 0);
    expect(masteryOf(c, 1000)).not.toBe('mastered');
    let now = c.fsrs.due;
    for (let i = 0; i < 6; i++) {
      c = review(c, 3, now);
      now = c.fsrs.due;
    }
    expect(c.successes).toBeGreaterThanOrEqual(3);
    expect(masteryOf(c, c.fsrs.last_review!)).toBe('mastered');
  });

  it('une erreur rapproche la révision et augmente la priorité', () => {
    let c = newCard('r', 'p', 'fen', 'w', 'e2e4', 0);
    let now = 0;
    for (let i = 0; i < 4; i++) {
      c = review(c, 3, now);
      now = c.fsrs.due;
    }
    const failed = review(c, 1, now);
    const succeeded = review(c, 3, now);
    expect(failed.fsrs.due - now).toBeLessThan(DAY);
    expect(succeeded.fsrs.due - now).toBeGreaterThan(DAY);
    expect(failed.fsrs.lapses).toBe(1);
    expect(failed.reviewLater).toBe(true);
    expect(priority(failed, now + 60000)).toBeGreaterThan(priority(succeeded, now + 60000));
    expect(priority(failed, failed.fsrs.due)).toBeGreaterThan(10);
    expect(masteryOf(failed, now + 1000)).toBe('learning');
    expect(isDue(failed, now + DAY)).toBe(true);
  });

  it('propose une note automatique cohérente', () => {
    const c = newCard('r', 'p', 'fen', 'w', 'e2e4', 0);
    const base = { timeMs: 3000, hints: 0, hadError: false, errorCountsAsFailure: true, slowMs: 12000, fastMs: 2000 };
    expect(autoGrade(c, { ...base, result: 'correct' })).toBe(3);
    expect(autoGrade(c, { ...base, result: 'correct', timeMs: 20000 })).toBe(2);
    expect(autoGrade(c, { ...base, result: 'correct', hints: 1 })).toBe(2);
    expect(autoGrade(c, { ...base, result: 'correct', hadError: true })).toBe(1);
    expect(autoGrade(c, { ...base, result: 'correct', hadError: true, errorCountsAsFailure: false })).toBe(2);
    expect(autoGrade(c, { ...base, result: 'error' })).toBe(1);
    expect(autoGrade(c, { ...base, result: 'timeout' })).toBe(1);
  });

  it('les présentations (mode guidé) ne comptent pas dans les statistiques', () => {
    const c = applyReview(newCard('r', 'p', 'fen', 'w', 'e2e4', 0), { grade: 1, result: 'learned', timeMs: 1000, hints: 0, now: 0, countsInStats: false });
    expect(c.attempts).toBe(0);
    expect(c.successes).toBe(0);
    expect(c.fsrs.reps).toBe(1);
  });

  it('réinitialise la planification quand les coups attendus changent', () => {
    let c = newCard('r', 'p', 'fen', 'w', 'e2e4', 0);
    c = review(c, 3, 0);
    const reset = resetScheduling(c, 'd2d4', 5000);
    expect(reset.answers).toBe('d2d4');
    expect(reset.fsrs.reps).toBe(0);
    expect(reset.attempts).toBe(c.attempts); // l'historique de tentatives est conservé
  });
});
