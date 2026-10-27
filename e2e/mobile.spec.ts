import { expect, test } from '@playwright/test';
import { boardSquare, waitForQuestion } from './helpers';

test('mobile : échiquier adapté à l’écran et coups au toucher', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Essayer avec la démonstration' }).tap();
  await page.waitForURL(/\/repertoire\//);
  const id = page.url().split('/repertoire/')[1];
  await page.goto(`/session/nouvelle?rep=${id}`);
  await page.getByRole('radio', { name: /Toute la sélection/ }).tap();
  await page.getByRole('button', { name: /^Commencer/ }).tap();
  await page.waitForURL(/\/session\/(?!nouvelle)/);
  await waitForQuestion(page);
  const box = (await page.locator('.review-board .board').boundingBox())!;
  const vw = page.viewportSize()!.width;
  expect(box.width).toBeGreaterThan(vw * 0.85);
  expect(box.x + box.width).toBeLessThanOrEqual(vw + 1);
  const tap = async (sq: string) => {
    const p = await boardSquare(page, '.review-board', sq);
    await page.touchscreen.tap(p.x, p.y);
  };
  await tap('e2');
  await tap('e4');
  await expect(page.locator('.stat-pill').first()).toContainText('1');
  await waitForQuestion(page);
  await tap('b1');
  await tap('c3');
  await expect(page.getByTestId('paul-feedback')).toContainText('Paul aurait trouvé');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});
