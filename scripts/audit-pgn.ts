/**
 * Audit des fichiers PGN du dépôt : lecture réelle, encodage, nombre de parties,
 * métadonnées, variantes, commentaires et validation de la légalité des coups.
 *
 * Usage : npm run audit:pgn [-- chemin/vers/fichier.pgn …]
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { parsePgn } from '../src/core/pgn/parse';

function findPgnFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (['node_modules', '.git', 'dist', 'android', 'tests'].includes(name)) continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) findPgnFiles(p, out);
    else if (/\.pgn$/i.test(name)) out.push(p);
  }
  return out;
}

const root = process.cwd();
const files = process.argv.slice(2).length ? process.argv.slice(2) : findPgnFiles(root);
if (!files.length) {
  console.log('Aucun fichier .pgn trouvé.');
  process.exit(0);
}
let failures = 0;
for (const f of files) {
  const buf = readFileSync(f);
  let encoding = 'UTF-8';
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(buf);
  } catch {
    encoding = 'non UTF-8 (lu en Windows-1252)';
    text = new TextDecoder('windows-1252').decode(buf);
  }
  const nonAscii = /[^\x00-\x7F]/.test(text);
  const { games, report } = parsePgn(text);
  const headerKeys = new Map<string, number>();
  for (const g of games) for (const [k] of g.headers) headerKeys.set(k, (headerKeys.get(k) ?? 0) + 1);
  const fenGames = games.filter((g) => g.headers.some(([k]) => k === 'FEN')).length;
  console.log(`\n=== ${relative(root, f)} ===`);
  console.log(`Taille : ${(buf.length / 1024).toFixed(1)} Ko — encodage : ${encoding}${nonAscii ? ' (contient des caractères non ASCII)' : ''}`);
  console.log(`Parties : ${report.games} (${report.validGames} analysées sans erreur fatale), dont ${fenGames} depuis une FEN`);
  console.log(`Coups : ${report.moves} — positions uniques : ${report.positions} — lignes (feuilles) : ${report.lines}`);
  console.log(`Variantes (RAV) : ${report.variations} — commentaires : ${report.comments} — flèches/cases : ${report.shapes}`);
  console.log(`Coups invalides conservés : ${report.invalidMoves} — durée d'analyse : ${report.durationMs} ms`);
  console.log(`En-têtes : ${[...headerKeys].map(([k, n]) => `${k}(${n})`).join(', ')}`);
  const errors = report.issues.filter((i) => i.severity === 'error');
  const warnings = report.issues.filter((i) => i.severity === 'warning');
  console.log(`Erreurs : ${errors.length} — avertissements : ${warnings.length}`);
  for (const i of report.issues) {
    console.log(`  [${i.severity}] partie ${i.gameIndex + 1} « ${i.gameLabel} »${i.moveLabel ? ` coup ${i.moveLabel}` : ''}${i.line ? ` (ligne ${i.line})` : ''} : ${i.message}`);
  }
  if (errors.length) failures++;
}
process.exit(failures ? 1 : 0);
