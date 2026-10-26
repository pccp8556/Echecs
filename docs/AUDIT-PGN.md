# Audit du dépôt et des fichiers PGN

Réalisé avant le développement, puis reproductible avec `npm run audit:pgn`.

## État initial du dépôt

- Dépôt `pccp8556/Echecs`, **public**, branche par défaut `main`.
- Contenu : `README.md` (vide, « # Echecs ») et un fichier PGN. Aucun code, aucun framework, aucun test, pas de `CLAUDE.md`.

## Fichier trouvé et réellement lu

`lichess_study_najdorf_by_remsbarber_2026.10.23.pgn` — étude Lichess « Fight the Sicilian » (système 6.f4 contre la Najdorf), annotateurs GM Martinez Alcantara / IM Dragos Ceres.

| Mesure | Résultat |
| --- | --- |
| Taille | 163,5 Ko |
| Encodage | UTF-8 valide (tirets cadratins « — » dans les commentaires), fins de ligne LF, sans BOM |
| Parties (chapitres) | 44 : introduction, 15 minutes, chapitres 1–11, versions « To Go » 1–11, « Test yourself » 1–20 |
| Positions de départ FEN | 20 (les « Test yourself »), toutes valides |
| Coups | 4 324, **tous légaux** depuis la position de départ déclarée |
| Positions uniques | 3 086 |
| Lignes | 441 feuilles dans les parties, 367 lignes distinctes après fusion des chapitres |
| Variantes entre parenthèses | 397 |
| Commentaires | 1 847 |
| Flèches / cases colorées | 1 851 (`%cal`, `%csl`) |
| NAG | `$13`, `$14`, `$15`, `$16`, `$17`, `$18`, `$36`, `$44`, `$132`, `$146` + `!`, `?`, `!?`, `?!`, `!!` |
| En-têtes | Event, Date, White, Black (42/44), Result, Annotator, Variant, ECO, Opening, StudyName, ChapterName, ChapterURL, FEN/SetUp (20) |
| Erreurs de syntaxe ou de légalité | **aucune** |
| Camp détecté | **Blancs** (les Blancs ont un seul coup prévu par position, les Noirs se ramifient) |

Remarques :
- Les en-têtes non standard de Lichess (`StudyName`, `ChapterName`, `ChapterURL`) sont conservés ; l’analyseur les signale comme inconnus, ces avertissements sont filtrés.
- Les versions « To Go » répètent des lignes des chapitres complets : la fusion par séquence de coups évite de réviser deux fois la même position.
- Aller-retour vérifié par test : import → export → import redonne exactement le même arbre (coups, variantes, commentaires, NAG, flèches).

## Accès GitHub

- Le fichier est lisible localement (clone) et publiquement (`raw.githubusercontent.com`, API GitHub) car le dépôt est public.
- Aucun jeton n’est utilisé ni stocké par l’application ; l’import d’un dépôt privé nécessite un jeton en lecture seule fourni par l’utilisateur à l’exécution.
- Le PGN n’est **pas** intégré au build publié (contenu d’un cours, vérifié par `tests/deploy.test.ts`).
