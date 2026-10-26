// Vérifie que netlify.toml contient exactement les en-têtes de deploy/security-headers.json.
import { readFileSync } from 'node:fs';
const headers = JSON.parse(readFileSync('deploy/security-headers.json', 'utf8'));
const toml = readFileSync('netlify.toml', 'utf8');
let ok = true;
for (const [k, v] of Object.entries(headers)) {
  if (!toml.includes(`${k} = ${JSON.stringify(v)}`)) {
    console.error(`En-tête manquant ou différent dans netlify.toml : ${k}`);
    ok = false;
  }
}
console.log(ok ? 'netlify.toml est synchronisé.' : 'netlify.toml doit être mis à jour.');
process.exit(ok ? 0 : 1);
