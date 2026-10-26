import { describe, expect, it } from 'vitest';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import headers from '../deploy/security-headers.json';

function walk(dir: string, out: string[] = []): string[] {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

describe('configuration Netlify', () => {
  const toml = readFileSync('netlify.toml', 'utf8');
  it('construit avec npm run build et publie dist', () => {
    expect(toml).toMatch(/command = "npm run build"/);
    expect(toml).toMatch(/publish = "dist"/);
  });
  it('redirige toutes les routes de la SPA vers index.html', () => {
    expect(toml).toMatch(/from = "\/\*"\s+to = "\/index.html"\s+status = 200/);
  });
  it('applique les mêmes en-têtes de sécurité que les tests E2E', () => {
    for (const [k, v] of Object.entries(headers)) expect(toml).toContain(`${k} = ${JSON.stringify(v)}`);
    expect(headers['Content-Security-Policy']).toContain("'wasm-unsafe-eval'");
  });
  it('ne déclare aucun secret', () => {
    expect(toml).not.toMatch(/TOKEN|SECRET|PASSWORD|github_pat_|ghp_/i);
  });
});

describe.skipIf(!existsSync('dist'))('contenu du build de production', () => {
  const files = existsSync('dist') ? walk('dist') : [];
  it('contient l’application, le manifeste, le service worker et Stockfish', () => {
    for (const f of ['dist/index.html', 'dist/sw.js', 'dist/manifest.webmanifest', 'dist/stockfish/stockfish-18-lite-single.wasm', 'dist/stockfish/COPYING.txt', 'dist/icons/icon-512.png'])
      expect(files).toContain(f);
  });
  it('ne publie aucun fichier PGN ni le contenu du PGN personnel', () => {
    expect(files.some((f) => /\.pgn$/i.test(f))).toBe(false);
    for (const f of files.filter((x) => /\.(js|html|json|css|webmanifest)$/.test(x))) {
      const t = readFileSync(f, 'utf8');
      expect(t.includes('remsbarber'), f).toBe(false);
      expect(t.includes('Martinez Alcantara'), f).toBe(false);
    }
  });
  it('n’embarque aucun jeton', () => {
    for (const f of files.filter((x) => /\.(js|html)$/.test(x))) {
      const t = readFileSync(f, 'utf8');
      expect(/github_pat_[A-Za-z0-9_]{20,}|ghp_[A-Za-z0-9]{30,}/.test(t), f).toBe(false);
    }
  });
});
