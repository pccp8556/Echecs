import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { parsePgn } from '../core/pgn/parse';
import { repertoireFromParsed } from '../core/repertoire/build';
import { exportRepertoirePgn } from '../core/repertoire/export';
import { addMove, findNode } from '../core/pgn/tree';
import { getDb, resetDbConnection, DB_NAME } from './db';
import {
  deleteRepertoire,
  duplicateRepertoire,
  getCards,
  getGames,
  getRepertoire,
  gradeCard,
  listRepertoires,
  listRevisions,
  listTrash,
  mergeRepertoires,
  restoreFromTrash,
  restoreRevision,
  saveNewRepertoire,
  saveRepertoireContent,
  addLogs,
  getLogs,
} from './repo';
import { exportBackup, importBackup, validateBackup, BackupError } from './backup';
import { buildForest } from '../core/repertoire/merged';
import { buildPositionIndex, answersSignature } from '../core/repertoire/positions';

const PGN = '[Event "Rep"]\n\n1. e4 { Le meilleur } e5 (1... c5 { Sicilienne } 2. Nf3 $14) 2. Nf3 Nc6 *';

async function seed(text = PGN, name = 'Test') {
  const { repertoire, games } = repertoireFromParsed(parsePgn(text), { name, source: { kind: 'paste', importedAt: 1, contentHash: 'x' } });
  await saveNewRepertoire(repertoire, games);
  return { repertoire, games };
}

beforeEach(async () => {
  await resetDbConnection();
  await new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase(DB_NAME);
    req.onsuccess = () => resolve();
    req.onerror = () => resolve();
  });
});

describe('stockage IndexedDB', () => {
  it('enregistre et recharge un répertoire avec ses parties', async () => {
    const { repertoire } = await seed();
    await resetDbConnection();
    const reps = await listRepertoires();
    expect(reps).toHaveLength(1);
    const games = await getGames(repertoire.id);
    expect(games).toHaveLength(1);
    expect(games[0].root.children[0].comments).toEqual(['Le meilleur']);
  });

  it('modifie un répertoire en conservant commentaires et variantes, avec historique', async () => {
    const { repertoire, games } = await seed();
    const g = games[0];
    const e5 = g.root.children[0].children[0];
    const r = addMove(g.root, e5.id, 'Nf3', g.maxId + 1);
    if ('error' in r) throw new Error(r.error);
    const r2 = addMove(r.root, r.id, 'Nc6', g.maxId + 2);
    if ('error' in r2) throw new Error(r2.error);
    const r3 = addMove(r2.root, findNode(r2.root, r.id)!.id, 'd6', g.maxId + 3);
    if ('error' in r3) throw new Error(r3.error);
    const updated = await saveRepertoireContent({ ...repertoire, modified: true }, [{ ...g, root: r3.root, modified: true, maxId: g.maxId + 3 }], 'Ajout de 2...d6');
    expect(updated.stats.lines).toBe(3);
    const reloaded = (await getGames(repertoire.id))[0];
    expect(reloaded.root.children[0].comments).toEqual(['Le meilleur']);
    expect(reloaded.root.children[0].children[1].comments).toEqual(['Sicilienne']);
    const pgn = exportRepertoirePgn(updated, [reloaded], { annotations: false });
    expect(pgn).toContain('{ Sicilienne }');
    expect(pgn).toContain('2... d6');
    const revs = await listRevisions(repertoire.id);
    expect(revs).toHaveLength(1);
    await restoreRevision(revs[0].id);
    const restored = (await getGames(repertoire.id))[0];
    expect(exportRepertoirePgn(updated, [restored], { annotations: false })).not.toContain('d6');
  });

  it('exporte le texte original tant qu’une partie n’est pas modifiée', async () => {
    const { repertoire, games } = await seed();
    const out = exportRepertoirePgn(repertoire, games, { annotations: false });
    expect(out.trim()).toBe(PGN.trim());
  });

  it('exporte et réimporte les marques personnelles', async () => {
    const { repertoire, games } = await seed();
    const forest = buildForest(games);
    const c5 = [...forest.byKey.values()].find((n) => n.san === 'c5')!;
    const marked = { ...repertoire, marks: { [c5.key]: 'experimental' as const } };
    const pgn = exportRepertoirePgn(marked, games, { annotations: true });
    expect(pgn).toContain('[%patmark experimental]');
    const again = repertoireFromParsed(parsePgn(pgn), { name: 'x', source: { kind: 'paste', importedAt: 1, contentHash: '' } });
    expect(Object.values(again.repertoire.marks)).toEqual(['experimental']);
  });

  it('supprime dans la corbeille puis restaure', async () => {
    const { repertoire } = await seed();
    await gradeCard({ cardId: `${repertoire.id}|p`, repertoireId: repertoire.id, posKey: 'p', fen: 'f', turn: 'w', answers: '', grade: 3, result: 'correct', timeMs: 1, hints: 0, now: 1, countsInStats: true });
    await deleteRepertoire(repertoire.id);
    expect(await listRepertoires()).toHaveLength(0);
    expect(await getCards(repertoire.id)).toHaveLength(0);
    expect(await listTrash()).toHaveLength(1);
    await restoreFromTrash(repertoire.id);
    expect(await getRepertoire(repertoire.id)).toBeDefined();
    expect(await getCards(repertoire.id)).toHaveLength(1);
  });

  it('duplique et fusionne sans toucher aux originaux', async () => {
    const a = await seed(PGN, 'A');
    const b = await seed('[Event "B"]\n\n1. d4 d5 2. c4 *', 'B');
    const dup = await duplicateRepertoire(a.repertoire.id, 'A (copie)');
    expect(dup!.id).not.toBe(a.repertoire.id);
    const merged = await mergeRepertoires([a.repertoire.id, b.repertoire.id], 'A+B');
    expect(merged!.stats.games).toBe(2);
    expect(await listRepertoires()).toHaveLength(4);
    expect((await getGames(a.repertoire.id))).toHaveLength(1);
  });

  it('rend obsolète la progression d’une position supprimée et réinitialise si les coups attendus changent', async () => {
    const { repertoire, games } = await seed();
    const index = buildPositionIndex(buildForest(games));
    const afterE5 = [...index.values()].find((p) => p.moves.some((m) => m.san === 'Nf3') && p.turn === 'w' && p.minPly === 2)!;
    const afterC5 = [...index.values()].find((p) => p.moves.some((m) => m.san === 'Nf3') && p.minPly === 2 && p !== afterE5)!;
    for (const p of [afterE5, afterC5]) {
      await gradeCard({ cardId: `${repertoire.id}|${p.posKey}`, repertoireId: repertoire.id, posKey: p.posKey, fen: p.fen, turn: 'w', answers: answersSignature(p), grade: 3, result: 'correct', timeMs: 1, hints: 0, now: 1, countsInStats: true });
    }
    // Nouvelle version : 1...c5 supprimé, et 2.Fc4 remplace 2.Cf3 après 1...e5.
    const { games: newGames } = repertoireFromParsed(parsePgn('[Event "Rep"]\n\n1. e4 e5 2. Bc4 *'), { name: 'x', source: { kind: 'paste', importedAt: 1, contentHash: '' } });
    await saveRepertoireContent(repertoire, [{ ...newGames[0], id: games[0].id, repertoireId: repertoire.id }], 'test');
    const cards = await getCards(repertoire.id);
    const cE5 = cards.find((c) => c.posKey === afterE5.posKey)!;
    const cC5 = cards.find((c) => c.posKey === afterC5.posKey)!;
    expect(cC5.obsolete).toBe(true);
    expect(cC5.successes).toBe(1);
    expect(cE5.obsolete).toBe(false);
    expect(cE5.fsrs.reps).toBe(0);
    expect(cE5.answers).not.toBe(answersSignature(afterE5));
  });

  it('exporte une sauvegarde complète puis la restaure (remplacement et fusion)', async () => {
    const { repertoire } = await seed();
    await addLogs([{ ts: 5, sessionId: 's', mode: 'full', repertoireId: repertoire.id, posKey: 'p', cardId: 'c', fen: 'f', color: 'w', moveNumber: 1, result: 'correct', firstTry: true, expectedSans: ['e4'], expectedUcis: ['e2e4'], timeMs: 1000, hints: 0, graded: true }]);
    const backup = JSON.parse(JSON.stringify(await exportBackup()));
    const file = validateBackup(backup);
    await deleteRepertoire(repertoire.id);
    const sum = await importBackup(file, 'replace');
    expect(sum.repertoires).toBe(1);
    expect(await getRepertoire(repertoire.id)).toBeDefined();
    expect(await getLogs()).toHaveLength(1);
    await importBackup(file, 'merge');
    expect(await getLogs()).toHaveLength(1);
    expect(() => validateBackup({ app: 'autre' })).toThrow(BackupError);
    expect(() => validateBackup({ app: 'paul-aurait-trouve', version: 1, data: {} })).toThrow(/incomplète/);
  });

  it('crée les index nécessaires', async () => {
    const db = await getDb();
    expect([...db.objectStoreNames].sort()).toEqual(['cards', 'folders', 'games', 'logs', 'meta', 'presets', 'repertoires', 'revisions', 'sessions', 'trash']);
  });
});
