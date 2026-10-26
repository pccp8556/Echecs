import { expect, type Page } from '@playwright/test';

export const USER_PGN = 'lichess_study_najdorf_by_remsbarber_2026.10.23.pgn';

export async function importUserPgn(page: Page) {
  await page.goto('/importer');
  await page.setInputFiles('[data-testid=file-input]', USER_PGN);
  const pending = page.getByTestId('pending-import');
  await expect(pending).toBeVisible({ timeout: 60_000 });
  await page.getByRole('button', { name: 'Importer', exact: true }).click();
  await page.waitForURL(/\/repertoire\//);
}

export async function boardSquare(page: Page, scope: string, square: string) {
  const board = page.locator(`${scope} .board`).first();
  const box = (await board.boundingBox())!;
  const flipped = (await page.locator(`${scope} .coord-rank`).first().textContent()) === '1';
  const f = 'abcdefgh'.indexOf(square[0]);
  const r = Number(square[1]);
  const x = flipped ? 7 - f : f;
  const y = flipped ? r - 1 : 8 - r;
  return { x: box.x + ((x + 0.5) * box.width) / 8, y: box.y + ((y + 0.5) * box.height) / 8 };
}

/** Joue un coup par glisser-déposer à la souris. */
export async function dragMove(page: Page, scope: string, from: string, to: string) {
  const a = await boardSquare(page, scope, from);
  const b = await boardSquare(page, scope, to);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move((a.x + b.x) / 2, (a.y + b.y) / 2, { steps: 5 });
  await page.mouse.move(b.x, b.y, { steps: 5 });
  await page.mouse.up();
}

/** Joue un coup par deux clics. */
export async function clickMove(page: Page, scope: string, from: string, to: string) {
  const a = await boardSquare(page, scope, from);
  await page.mouse.click(a.x, a.y);
  const b = await boardSquare(page, scope, to);
  await page.mouse.click(b.x, b.y);
}

export async function waitForQuestion(page: Page) {
  await expect(page.locator('.turn-badge')).toContainText('À toi', { timeout: 15_000 });
}
