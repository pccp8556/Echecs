import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { parsePgn } from './parse';
import { exportGame, joinGames } from './export';
import { splitGames } from './split';
import { countTree, mainline, addMove, deleteNode, promoteNode, findNode } from './tree';
import type { GameRoot } from './types';

const strip = (r: GameRoot) => JSON.stringify(r, (k, v) => (k === 'id' ? undefined : v));

describe('import PGN', () => {
  it('lit un PGN simple', () => {
    const { games, report } = parsePgn('[Event "Test"]\n[White "A"]\n[Black "B"]\n[Result "1-0"]\n\n1. e4 e5 2. Nf3 Nc6 3. Bb5 1-0\n');
    expect(games).toHaveLength(1);
    expect(report.issues.filter((i) => i.severity === 'error')).toHaveLength(0);
    const line = mainline(games[0].root).map((n) => n.san);
    expect(line).toEqual(['e4', 'e5', 'Nf3', 'Nc6', 'Bb5']);
    expect(games[0].headers).toContainEqual(['White', 'A']);
  });

  it('lit plusieurs parties, même sans ligne vide ni en-têtes', () => {
    const text = '[Event "1"]\n1. e4 e5 *\n[Event "2"]\n1. d4 d5 *\n\n1. c4 e5 1-0\n1. Nf3 d5 0-1';
    const { games } = parsePgn(text);
    expect(games.map((g) => g.root.children[0].san)).toEqual(['e4', 'd4', 'c4', 'Nf3']);
    expect(splitGames(text)).toHaveLength(4);
  });

  it('construit un arbre à partir de variantes imbriquées', () => {
    const { games, report } = parsePgn('1. e4 e5 (1... c5 2. Nf3 (2. c3 d5 (2... Nf6 3. e5)) 2... d6) 2. Nf3 *');
    const root = games[0].root;
    const e4 = root.children[0];
    expect(e4.children.map((c) => c.san)).toEqual(['e5', 'c5']);
    const c5 = e4.children[1];
    expect(c5.children.map((c) => c.san)).toEqual(['Nf3', 'c3']);
    const c3 = c5.children[1];
    expect(c3.children.map((c) => c.san)).toEqual(['d5', 'Nf6']);
    expect(c3.children[1].children[0].san).toBe('e5');
    expect(c5.children[0].children[0].san).toBe('d6');
    expect(report.lines).toBe(4);
    expect(report.variations).toBe(3);
  });

  it('conserve commentaires, flèches, cases et commandes', () => {
    const { games } = parsePgn('{ Intro } 1. e4 { Le meilleur } { [%csl Ge4][%cal Rd2d4] } e5 { [%clk 0:05:00] } *');
    const root = games[0].root;
    expect(root.comments).toEqual(['Intro']);
    const e4 = root.children[0];
    expect(e4.comments).toEqual(['Le meilleur']);
    expect(e4.shapes).toEqual([
      { color: 'R', from: 'd2', to: 'd4' },
      { color: 'G', from: 'e4' },
    ]);
    expect(e4.children[0].commands).toEqual({ clk: '0:05:00' });
  });

  it('lit les NAG numériques et symboliques', () => {
    const { games } = parsePgn('1. e4! e5? 2. Nf3!? Nc6?! 3. Bb5 $14 a6 $146 *');
    const nags = [];
    let n = games[0].root.children[0];
    while (n) {
      nags.push(n.nags ?? []);
      n = n.children[0];
    }
    expect(nags).toEqual([[1], [2], [5], [6], [14], [146]]);
  });

  it('lit les métadonnées et la position FEN de départ', () => {
    const fen = 'r1bqk2r/1p2bppp/p1np1n2/8/4PB2/1NN5/PPP1Q1PP/R3KB1R w KQkq - 0 10';
    const { games } = parsePgn(`[Event "Test yourself"]\n[SetUp "1"]\n[FEN "${fen}"]\n[ECO "B93"]\n\n10. h3! b5 11. O-O-O *`);
    const g = games[0];
    expect(g.root.fen).toBe(fen);
    expect(mainline(g.root).map((x) => x.san)).toEqual(['h3', 'b5', 'O-O-O']);
    expect(g.headers).toContainEqual(['ECO', 'B93']);
  });

  it('signale une FEN invalide sans planter', () => {
    const { games, report } = parsePgn('[FEN "8/8/8/8/8/8/8/8 w - - 0 1"]\n\n1. e4 *');
    expect(games[0].fatal).toBe(true);
    expect(report.issues[0].message).toMatch(/FEN/);
  });

  it('rapporte une erreur de syntaxe avec la partie et la ligne, sans perdre le texte', () => {
    const text = '[Event "OK"]\n\n1. e4 e5 *\n\n[Event "Cassée"]\n\n1. e4 e5 2. Nf3 } Nc6 *\n\n[Event "OK2"]\n\n1. d4 *';
    const { games, report } = parsePgn(text);
    expect(games).toHaveLength(3);
    expect(games[1].fatal).toBe(true);
    expect(games[1].rawPgn).toContain('2. Nf3 } Nc6');
    const err = report.issues.find((i) => i.severity === 'error')!;
    expect(err.gameIndex).toBe(1);
    expect(err.gameLabel).toBe('Cassée');
    expect(err.line).toBe(7);
    expect(err.moveLabel).toBe('2.Nf3');
    expect(games[2].root.children[0].san).toBe('d4');
  });

  it('conserve une variante contenant un coup illégal au lieu de la supprimer', () => {
    const text = '1. e4 e5 2. Nf3 (2. Ke3 Nc6 3. d4) (2. Bc4 Nf6) Nc6 *';
    const { games, report } = parsePgn(text);
    const e5 = games[0].root.children[0].children[0];
    expect(e5.children.map((c) => c.san)).toEqual(['Nf3', 'Ke3', 'Bc4']);
    const bad = e5.children[1];
    expect(bad.invalid?.tail).toContain('Nc6');
    expect(bad.invalid?.tail).toContain('d4');
    expect(report.invalidMoves).toBe(1);
    expect(report.issues.some((i) => i.moveLabel === '2.Ke3')).toBe(true);
    // L'export conserve la variante invalide.
    const out = exportGame(games[0].headers, games[0].root);
    expect(out).toContain('(2. Ke3 2... Nc6 3. d4)');
    const again = parsePgn(out);
    expect(again.games[0].root.children[0].children[0].children[1].invalid?.tail).toBe('2... Nc6 3. d4');
  });

  it('gère un fichier vide', () => {
    const { games, report } = parsePgn('   \n\n');
    expect(games).toHaveLength(0);
    expect(report.issues[0].severity).toBe('error');
  });

  it('gère BOM, CRLF, accents, emoji et roques avec des zéros', () => {
    const text = '﻿[Event "Défense française – « test » 😀"]\r\n[Annotator "Éloïse"]\r\n\r\n1. e4 e6 2. d4 d5 3. Nc3 Nf6 4. Bg5 Be7 5. e5 Nfd7 6. Bxe7 Qxe7 7. f4 0-0 8. Nf3 c5 { Très thématique… } *\r\n';
    const { games, report } = parsePgn(text);
    expect(report.issues.filter((i) => i.severity === 'error')).toHaveLength(0);
    expect(games[0].headers[0]).toEqual(['Event', 'Défense française – « test » 😀']);
    const sans = mainline(games[0].root).map((n) => n.san);
    expect(sans).toContain('O-O');
    expect(mainline(games[0].root).at(-1)!.comments).toEqual(['Très thématique…']);
  });

  it('ignore les lignes d’échappement « % » et les commentaires « ; »', () => {
    const { games } = parsePgn('% généré par un outil\n1. e4 ; commentaire de fin de ligne\n e5 *');
    expect(mainline(games[0].root).map((n) => n.san)).toEqual(['e4', 'e5']);
    expect(games[0].root.children[0].comments).toEqual(['commentaire de fin de ligne']);
  });

  it('regroupe les variantes en double sans perdre de contenu', () => {
    const { games, report } = parsePgn('1. e4 (1. e4 { doublon } e5 2. Nf3) c5 *');
    const e4 = games[0].root.children[0];
    expect(games[0].root.children).toHaveLength(1);
    expect(e4.comments).toEqual(['doublon']);
    expect(e4.children.map((c) => c.san)).toEqual(['c5', 'e5']);
    expect(report.issues.some((i) => i.severity === 'warning')).toBe(true);
  });

  it('analyse un gros fichier (2 000 parties) en un temps raisonnable', () => {
    const one = '[Event "Gros"]\n\n1. e4 c5 2. Nf3 d6 3. d4 cxd4 4. Nxd4 Nf6 5. Nc3 a6 (5... Nc6 6. Bg5) 6. f4 e5 7. Nb3 Nbd7 8. g4 h6 9. Qf3 b5 10. Be3 Bb7 *\n\n';
    const text = one.repeat(2000);
    const t0 = Date.now();
    const { games, report } = parsePgn(text);
    const dt = Date.now() - t0;
    expect(games).toHaveLength(2000);
    expect(report.moves).toBe(2000 * 22);
    expect(dt).toBeLessThan(60000);
  });
});

describe('export PGN', () => {
  it('fait un aller-retour sans perte sur des variantes, commentaires et NAG', () => {
    const text = '[Event "AR"]\n[Result "*"]\n\n{ Début } 1. e4 { a } e5 (1... c5 { b } { [%cal Gg1f3] } 2. Nf3 $14 (2. c3)) 2. Nf3!? Nc6 *\n';
    const a = parsePgn(text);
    const out = exportGame(a.games[0].headers, a.games[0].root);
    const b = parsePgn(out);
    expect(strip(b.games[0].root)).toEqual(strip(a.games[0].root));
    expect(b.games[0].headers).toEqual(a.games[0].headers);
  });

  it('fait un aller-retour sans perte sur le PGN Lichess du dépôt', () => {
    const text = readFileSync(new URL('../../../lichess_study_najdorf_by_remsbarber_2026.10.23.pgn', import.meta.url), 'utf8');
    const a = parsePgn(text);
    expect(a.games).toHaveLength(44);
    expect(a.report.invalidMoves).toBe(0);
    expect(a.report.issues.filter((i) => i.severity === 'error')).toHaveLength(0);
    const out = joinGames(a.games.map((g) => exportGame(g.headers, g.root)));
    const b = parsePgn(out);
    expect(b.games).toHaveLength(44);
    a.games.forEach((g, i) => expect(strip(b.games[i].root)).toEqual(strip(g.root)));
  });
});

describe('édition de l’arbre', () => {
  it('ajoute, promeut et supprime des variantes de manière immuable', () => {
    const { games } = parsePgn('1. e4 e5 2. Nf3 *');
    const root = games[0].root;
    const e4 = root.children[0];
    const r1 = addMove(root, e4.id, 'c5', 100);
    if ('error' in r1) throw new Error(r1.error);
    expect(r1.created).toBe(true);
    expect(findNode(r1.root, e4.id)!.children.map((c) => c.san)).toEqual(['e5', 'c5']);
    expect(root.children[0].children).toHaveLength(1); // original intact
    const r2 = promoteNode(r1.root, 100);
    expect(findNode(r2, e4.id)!.children.map((c) => c.san)).toEqual(['c5', 'e5']);
    const r3 = deleteNode(r2, findNode(r2, e4.id)!.children[1].id);
    expect(findNode(r3, e4.id)!.children.map((c) => c.san)).toEqual(['c5']);
    expect(countTree(r3).moves).toBe(2);
    expect(addMove(r3, e4.id, 'Ke3', 101)).toEqual({ error: 'Coup illégal' });
  });
});
