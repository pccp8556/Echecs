import { expect, test } from '@playwright/test';
import { clickMove, dragMove, importUserPgn, waitForQuestion } from './helpers';

test.describe('navigation et routes SPA', () => {
  test('toutes les pages s’affichent, y compris en accès direct', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    const routes: Array<[string, RegExp]> = [
      ['/', /Tes ouvertures/],
      ['/bibliotheque', /Mes répertoires/],
      ['/importer', /Importer des PGN/],
      ['/session/nouvelle', /Nouvelle session/],
      ['/statistiques', /Ta progression/],
      ['/parametres', /Préférences/],
      ['/une-page-inexistante', /Page introuvable/],
    ];
    for (const [path, heading] of routes) {
      await page.goto(path);
      await expect(page.locator('h1, h3').filter({ hasText: heading }).first()).toBeVisible();
    }
    expect(errors).toEqual([]);
  });

  test('la navigation latérale fonctionne', async ({ page }) => {
    await page.goto('/');
    const nav = page.getByRole('complementary', { name: 'Navigation principale' });
    await nav.getByRole('link', { name: 'Statistiques' }).click();
    await expect(page).toHaveURL(/statistiques/);
    await nav.getByRole('link', { name: 'Bibliothèque' }).click();
    await expect(page.getByRole('heading', { name: 'Mes répertoires' })).toBeVisible();
  });
});

test.describe('import du PGN réel', () => {
  test('analyse le fichier du dépôt et affiche un rapport exact', async ({ page }) => {
    await page.goto('/importer');
    await page.setInputFiles('[data-testid=file-input]', 'lichess_study_najdorf_by_remsbarber_2026.10.23.pgn');
    const card = page.getByTestId('pending-import');
    await expect(card).toBeVisible({ timeout: 60_000 });
    const grid = card.locator('.report-grid');
    await expect(grid).toContainText('Parties / chapitres44');
    await expect(grid).toContainText('Coups4324');
    await expect(grid).toContainText('Coups invalides0');
    await expect(card).toContainText('Auto (Blancs)');
    await expect(card).toContainText('Aucune erreur');
    await page.getByRole('button', { name: 'Importer', exact: true }).click();
    await page.waitForURL(/\/repertoire\//);
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Fight the Sicilian');
    await expect(page.getByText('44 parties').first()).toBeVisible();
  });

  test('importe un PGN collé contenant une erreur sans rien perdre', async ({ page }) => {
    await page.goto('/importer');
    await page.getByRole('tab', { name: 'Coller' }).click();
    await page.getByLabel('Texte PGN').fill('[Event "Collé"]\n\n1. e4 e5 2. Nf3 (2. Ke3 Nc6) Nc6 *');
    await page.getByRole('button', { name: 'Analyser' }).click();
    const card = page.getByTestId('pending-import');
    await expect(card).toContainText('Coup illégal ou illisible');
    await expect(card).toContainText('2.Ke3');
    await expect(card.locator('.report-grid')).toContainText('Coups invalides1');
  });
});

test.describe('sélection, révision et « Paul aurait trouvé »', () => {
  test('sélectionne une sous-variante puis révise uniquement celle-ci', async ({ page }) => {
    await importUserPgn(page);
    const summary = page.locator('.selection-summary');
    await expect(summary).toContainText('367 lignes');
    await page.getByRole('button', { name: 'Rien', exact: true }).click();
    await expect(summary).toContainText('0 ligne');
    await page.getByRole('checkbox', { name: 'Inclure la variante 6...g6 7.e5', exact: true }).check();
    await expect(summary).toContainText('33 lignes');
    await page.getByRole('button', { name: 'Réviser la sélection' }).click();
    await page.waitForURL(/session\/nouvelle/);
    await page.getByRole('radio', { name: /Répertoire complet/ }).click();
    await expect(page.locator('.setup-summary')).toContainText('Lignes33');
    await page.getByRole('button', { name: 'Commencer' }).click();
    await page.waitForURL(/\/session\/(?!nouvelle)/);
    await waitForQuestion(page);
    // Le tronc d'approche est joué automatiquement : la première question est 7.e5.
    await expect(page.locator('.moves-card')).toContainText('6.f4');
    await expect(page.locator('.moves-card')).toContainText('g6');
    await dragMove(page, '.review-board', 'e4', 'e5');
    await expect(page.locator('.stat-pill').first()).toContainText('1');
  });

  test('coup conforme, erreur de répertoire, correction, coup illégal et reprise', async ({ page }) => {
    await importUserPgn(page);
    await page.getByRole('button', { name: 'Réviser la sélection' }).click();
    await page.getByRole('radio', { name: /Répertoire complet/ }).click();
    await page.getByRole('button', { name: 'Commencer' }).click();
    await page.waitForURL(/\/session\/(?!nouvelle)/);
    await waitForQuestion(page);
    await dragMove(page, '.review-board', 'e2', 'e4');
    await waitForQuestion(page);
    await expect(page.locator('.moves-card')).toContainText('c5');
    await clickMove(page, '.review-board', 'f1', 'c4');
    const paul = page.getByTestId('paul-feedback');
    await expect(paul).toBeVisible();
    await expect(paul).toContainText('Paul aurait trouvé');
    await expect(paul).toContainText('Tu as joué 2.Fc4, mais ton répertoire prévoit 2.Cf3.');
    await expect(paul).toContainText('La ligne de référence continue avec');
    await paul.getByRole('button', { name: 'Rejouer la position' }).click();
    await clickMove(page, '.review-board', 'g1', 'f3');
    await waitForQuestion(page);
    await expect(page.locator('.moves-card')).toContainText('d6');
    const before = await page.locator('.stat-pill.danger').textContent();
    await clickMove(page, '.review-board', 'd1', 'd8');
    await expect(page.getByTestId('paul-feedback')).toHaveCount(0);
    expect(await page.locator('.stat-pill.danger').textContent()).toBe(before);
    const url = page.url();
    await page.reload();
    await waitForQuestion(page);
    expect(page.url()).toBe(url);
    await expect(page.locator('.moves-card')).toContainText('d6');
    await page.goto('/');
    await page.getByRole('link', { name: /Reprendre ma session/ }).click();
    await waitForQuestion(page);
    await expect(page.locator('.moves-card')).toContainText('d6');
  });

  test('les statistiques reflètent les réponses réelles', async ({ page }) => {
    await importUserPgn(page);
    await page.goto('/statistiques');
    await expect(page.getByText('Pas encore de statistiques')).toBeVisible();
    await page.goto('/');
    await page.getByRole('button', { name: 'Commencer ma révision' }).click();
    await page.waitForURL(/\/session\/(?!nouvelle)/);
    await waitForQuestion(page);
    await dragMove(page, '.review-board', 'e2', 'e4');
    await page.waitForTimeout(400);
    await waitForQuestion(page);
    await clickMove(page, '.review-board', 'a2', 'a3');
    await expect(page.getByTestId('paul-feedback')).toBeVisible();
    await page.getByRole('button', { name: 'Terminer la session' }).click();
    await expect(page.getByText('Session terminée')).toBeVisible();
    await page.goto('/statistiques');
    const first = page.locator('.kpi').first();
    await expect(first).toContainText('50');
    await expect(first).toContainText('1 / 2 du premier coup');
    await expect(page.getByText('Erreurs les plus fréquentes')).toBeVisible();
    await expect(page.locator('.error-item').first()).toContainText('a3');
  });
});

test.describe('éditeur et export', () => {
  test('ajoute une variante, enregistre, et l’export PGN la contient', async ({ page }) => {
    await page.goto('/importer');
    await page.getByRole('tab', { name: 'Coller' }).click();
    await page.getByLabel('Texte PGN').fill('[Event "Édition"]\n\n1. e4 { Le meilleur } e5 2. Nf3 Nc6 *');
    await page.getByRole('button', { name: 'Analyser' }).click();
    await page.getByRole('button', { name: 'Importer', exact: true }).click();
    await page.waitForURL(/\/repertoire\//);
    await page.getByRole('link', { name: 'Éditer' }).click();
    await page.waitForURL(/editer/);
    await page.locator('.pgn-move', { hasText: /^1\.\.\.e5$/ }).click();
    await dragMove(page, '.editor-board', 'f1', 'c4');
    await expect(page.locator('.pgn-var')).toContainText('2.Fc4');
    const comment = page.getByLabel('Commentaire après le coup');
    await comment.fill('Italienne');
    await comment.blur();
    await page.getByRole('button', { name: 'Enregistrer', exact: true }).click();
    await expect(page.getByText('Répertoire enregistré')).toBeVisible();
    await page.getByRole('button', { name: 'Explorer' }).click();
    await page.waitForURL(/\/repertoire\/[^/]+$/);
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Exporter', exact: true }).click();
    const file = await download;
    const chunks: Buffer[] = [];
    for await (const c of await file.createReadStream()) chunks.push(c as Buffer);
    const text = Buffer.concat(chunks).toString('utf8');
    expect(text).toContain('{ Le meilleur }');
    expect(text).toContain('(2. Bc4 { Italienne })');
  });
});

test.describe('production : PWA et workers', () => {
  test('manifeste, service worker et moteur Stockfish', async ({ page }) => {
    const manifest = await page.request.get('/manifest.webmanifest');
    expect(manifest.ok()).toBeTruthy();
    expect((await manifest.json()).short_name).toBe('Paul');
    const wasm = await page.request.get('/stockfish/stockfish-18-lite-single.wasm');
    expect(wasm.ok()).toBeTruthy();
    expect(wasm.headers()['content-type']).toContain('wasm');
    await page.goto('/');
    await page.getByRole('button', { name: 'Essayer avec la démonstration' }).click();
    await page.waitForURL(/\/repertoire\//);
    await page.getByRole('button', { name: 'Analyser' }).click();
    await expect(page.locator('.engine-score')).toHaveText(/^([+-]?\d+\.\d\d|#-?\d+)$/, { timeout: 60_000 });
    await expect(page.locator('.engine-lines li').first()).toBeVisible();
    await page.waitForFunction(async () => !!(await navigator.serviceWorker.getRegistration()), null, { timeout: 20_000 });
  });
});
