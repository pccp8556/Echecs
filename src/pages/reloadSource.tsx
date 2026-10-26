import { parsePgn } from '../core/pgn/parse';
import { hashText, computeStats, gameRecordFromParsed } from '../core/repertoire/build';
import type { Repertoire, SourceInfo } from '../core/repertoire/types';
import { fetchGithubFile, fetchUrlText, getToken } from '../integrations/github';
import { confirmDialog, toast } from '../ui/kit';
import { replaceFromSource } from './importHelpers';
import { readPgnFile } from '../workers/parseClient';

function pickFile(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.pgn,.txt,application/x-chess-pgn,text/plain';
    input.onchange = () => resolve(input.files?.[0] ?? null);
    input.addEventListener('cancel', () => resolve(null));
    input.click();
  });
}

/**
 * Recharge un répertoire depuis sa source. Ne remplace jamais silencieusement :
 * affiche les différences, signale les modifications locales (conflit) et
 * conserve l'ancienne version dans l'historique.
 */
export async function reloadFromSource(rep: Repertoire): Promise<Repertoire | undefined> {
  let text: string;
  let source: SourceInfo;
  try {
    if (rep.source.kind === 'github' && rep.source.github) {
      const g = rep.source.github;
      const f = await fetchGithubFile({ owner: g.owner, repo: g.repo, path: g.path, ref: g.ref }, await getToken());
      if (f.sha && g.sha && f.sha === g.sha) {
        toast.success('Déjà à jour', `Le fichier ${g.path} n’a pas changé sur GitHub depuis l’import.`);
        return;
      }
      text = f.text;
      source = { ...rep.source, github: { ...g, sha: f.sha ?? g.sha }, importedAt: Date.now(), contentHash: hashText(text) };
    } else if (rep.source.kind === 'url' && rep.source.url) {
      text = await fetchUrlText(rep.source.url);
      source = { ...rep.source, importedAt: Date.now(), contentHash: hashText(text) };
    } else {
      const ok = await confirmDialog({
        title: 'Recharger depuis un fichier',
        message:
          rep.source.kind === 'file'
            ? `Le navigateur ne peut pas relire seul le fichier « ${rep.source.fileName ?? 'd’origine'} ». Choisis sa nouvelle version sur ton appareil.`
            : 'Ce répertoire n’a pas de source rechargeable. Tu peux choisir un fichier PGN pour remplacer son contenu.',
        confirmLabel: 'Choisir un fichier',
      });
      if (!ok) return;
      const file = await pickFile();
      if (!file) return;
      text = (await readPgnFile(file)).text;
      source = { kind: 'file', fileName: file.name, fileLastModified: file.lastModified, importedAt: Date.now(), contentHash: hashText(text) };
    }
  } catch (e) {
    toast.error('Rechargement impossible', e instanceof Error ? e.message : String(e));
    return;
  }
  if (source.contentHash === rep.source.contentHash && !rep.modified) {
    toast.success('Déjà à jour', 'Le contenu de la source est identique à celui importé.');
    return;
  }
  const parsed = parsePgn(text);
  if (!parsed.games.length) {
    toast.error('Source vide', 'La nouvelle version ne contient aucune partie : rien n’a été modifié.');
    return;
  }
  const after = computeStats(parsed.games.map((g) => gameRecordFromParsed(g, rep.id)));
  const before = rep.stats;
  const diff = (a: number, b: number) => (b - a === 0 ? '=' : b - a > 0 ? `+${b - a}` : `${b - a}`);
  const ok = await confirmDialog({
    title: rep.modified ? 'Conflit : modifications locales' : 'Nouvelle version de la source',
    danger: rep.modified,
    message: (
      <div className="stack-sm">
        {rep.modified && (
          <p>
            <strong>Tu as modifié ce répertoire dans l’application depuis son import.</strong> Recharger remplacera ces modifications par la version de la source.
            Exporte d’abord ton PGN si tu veux les conserver (une copie de l’état actuel est aussi gardée dans l’historique).
          </p>
        )}
        <table className="table">
          <thead>
            <tr>
              <th />
              <th>Actuel</th>
              <th>Source</th>
              <th>Écart</th>
            </tr>
          </thead>
          <tbody>
            {(
              [
                ['Parties', before.games, after.games],
                ['Coups', before.moves, after.moves],
                ['Lignes', before.lines, after.lines],
                ['Commentaires', before.comments, after.comments],
                ['Erreurs', before.errors, after.errors],
              ] as const
            ).map(([k, a, b]) => (
              <tr key={k}>
                <td>{k}</td>
                <td className="tabular">{a}</td>
                <td className="tabular">{b}</td>
                <td className="tabular">{diff(a, b)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="small muted">La progression est conservée pour les positions inchangées ; celles qui disparaissent sont mises de côté, pas transférées.</p>
      </div>
    ),
    confirmLabel: rep.modified ? 'Remplacer quand même' : 'Mettre à jour',
  });
  if (!ok) return;
  const updated = await replaceFromSource(rep, parsed, source);
  toast.success('Répertoire mis à jour', 'L’ancienne version est disponible dans l’historique.');
  return updated;
}
