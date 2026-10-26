/**
 * PGN de démonstration, clairement identifié comme tel. Il sert uniquement à
 * découvrir l'application avant d'importer ses propres fichiers.
 */
export const DEMO_NAME = 'Démonstration — Partie italienne (exemple)';

export const DEMO_PGN = `[Event "Démonstration : répertoire italien (exemple)"]
[White "Démo"]
[Black "Réponses adverses"]
[Result "*"]
[ECO "C50"]
[Opening "Partie italienne"]
[Annotator "Exemple fourni avec l'application"]

{ Répertoire de démonstration avec les Blancs. Remplace-le par tes propres PGN. }
1. e4 e5 2. Nf3 Nc6 (2... Nf6 { La défense Petrov. } 3. Nxe5 d6 4. Nf3 Nxe4 5. d4 d5 6. Bd3)
(2... d6 { La défense Philidor. } 3. d4 exd4 (3... Nf6 4. Nc3 Nbd7 5. Bc4) 4. Nxd4 Nf6 5. Nc3 Be7 6. Be2)
3. Bc4 { L'italienne : le fou vise f7. } Bc5 (3... Nf6 { Les deux cavaliers. } 4. d3 { Solide, on évite les complications de 4.Cg5. } Be7 5. O-O O-O 6. Re1 d6 7. c3)
(3... Be7 { La défense hongroise. } 4. d4 d6 5. d5 Nb8 6. Bd3) 4. c3 { Prépare d4. } Nf6 (4... d6 5. d4 exd4 6. cxd4 Bb4+ 7. Nc3) 5. d3 d6 6. O-O O-O
(6... a6 7. a4 { Garde l'espace à l'aile dame. } Ba7 8. Re1) 7. Re1 a6 8. a4 Ba7 9. h3 { Empêche Fg4. } *

[Event "Démonstration : Sicilienne Alapin (exemple)"]
[White "Démo"]
[Black "Réponses adverses"]
[Result "*"]
[ECO "B22"]
[Opening "Sicilienne Alapin"]

1. e4 c5 2. c3 { L'Alapin : on prépare d4 avec un centre de pions. } Nf6 (2... d5 3. exd5 Qxd5 4. d4 Nf6 5. Nf3 Bg4 6. Be2 e6 7. O-O)
(2... e6 3. d4 d5 4. exd5 exd5 5. Nf3 Nc6 6. Bb5) 3. e5 Nd5 4. d4 cxd4 5. Nf3 Nc6 6. cxd4 d6 7. Bc4 Nb6 8. Bb5 *
`;
