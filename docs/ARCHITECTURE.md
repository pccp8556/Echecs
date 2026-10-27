# Architecture

```
src/
  core/                 logique pure, sans React (testée par Vitest)
    chess/              FEN, clés de position, notation (fr/en/figurines), NAG
    pgn/                découpage, analyse, arbre de coups, export
    repertoire/         modèle, arbre fusionné, positions, sélection, lignes, recherche, export annoté
    review/             moteur de révision (machine à états), retours, configuration des sessions
    srs/                répétition espacée FSRS (ts-fsrs), niveaux de maîtrise, priorités
    stats/              agrégations sur le journal des réponses
  storage/              IndexedDB (idb) : dépôt, corbeille, versions, sauvegarde complète
  integrations/         GitHub (lecture), Stockfish (UCI dans un Worker)
  workers/              analyse PGN en arrière-plan
  state/                stores Zustand (réglages, bibliothèque, sélections, session)
  ui/                   échiquier, composants, graphiques, panneau d'analyse
  pages/                écrans de l'application
```

## Modèle de données

- **Répertoire** = un fichier PGN importé (nom, dossier, étiquettes, favori, camp joué, source, statistiques, marques personnelles par chemin).
- **Partie** (`GameRecord`) : en-têtes (ordre conservé), arbre de coups, **texte PGN d’origine** (exporté tel quel tant que la partie n’est pas modifiée), problèmes d’import.
- **Arbre de coups** : `children[0]` = suite principale, les suivants = variantes. Chaque nœud garde SAN canonique, UCI, FEN, NAG, commentaires avant/après, flèches/cases (`%cal`/`%csl`) et autres commandes (`%clk`, `%eval`…). Un coup illégal devient un nœud **invalide** qui conserve le texte de la suite : il est exporté à l’identique et exclu des révisions.
- **Arbre fusionné** : les chapitres sont réunis par séquence de coups depuis leur position de départ (une racine par FEN distincte). Les **transpositions** sont reliées par clé de position (`placement + trait + roques + prise en passant jouable`).
- **Sélection** : règles « inclure / exclure ce sous-arbre » sur l’arbre fusionné + filtre de chapitres ; les lignes marquées « abandonnées » sont exclues. Un nœud non sélectionné qui mène à la sélection forme le **tronc d’approche**, joué automatiquement.
- **Ligne** = chemin racine → feuille de la sélection (dédupliqué entre chapitres).
- **Carte de révision** = (répertoire, position où l’utilisateur doit jouer). Réponses acceptées = coups sélectionnés depuis cette position, toutes transpositions confondues. La **signature des réponses** est stockée : si le PGN change les coups attendus, la planification est réinitialisée ; si la position disparaît, la carte devient obsolète (historique conservé, jamais transféré à une autre position).

## Moteur de révision

Machine à états pure et sérialisable (`core/review/engine.ts`) : `auto` (coup adverse/contexte), `question`, `feedback`, `itemDone`, `finished`. Les effets (journal, notes FSRS, corrections de note) sont appliqués par le store, ce qui rend le moteur testable et la session **reprenable** après fermeture.

Validation d’un coup, dans l’ordre :
1. illégal → refusé, aucune pénalité ;
2. dans les coups sélectionnés depuis cette position → correct (si c’est une autre variante sélectionnée, le moteur **suit une ligne compatible**) ;
3. dans le répertoire mais hors sélection → information, aucune pénalité ;
4. aucun coup de référence → information ;
5. sinon → **erreur de répertoire** : « Paul aurait trouvé ».

Une seule entrée de journal par question (première résolution) ; la note FSRS est appliquée une fois (À revoir / Difficile / Bien / Facile, choisie par l’utilisateur s’il l’a demandé).

Quatre modes : révision du jour et erreurs (par positions), apprendre et toute la sélection (par lignes). Une position déjà réussie dans la session n’est pas redemandée quand plusieurs lignes partagent le même début. Pendant une question, l’interface ne montre ni le nom de la ligne ni celui du chapitre, et le retour d’erreur ne donne que le coup attendu (pas la suite de la ligne).

Gravité d’une erreur : nombre de lignes de la sélection qui passent par le coup attendu, ou oubli d’une position déjà connue. Aucune évaluation échiquéenne n’est inventée : l’explication vient du commentaire du PGN, sinon un message neutre.

## Répétition espacée

FSRS (ts-fsrs, rétention cible 90 % réglable). Note automatique : erreur/solution/temps écoulé → À revoir ; bonne réponse avec indice ou lente → Difficile ; rapide et déjà stable → Facile ; sinon Bien. « Maîtrisée » exige au moins 3 réussites et une stabilité ≥ 21 jours. Les présentations du mode guidé ne comptent pas dans les statistiques.

## Stockage

IndexedDB : `repertoires`, `games`, `folders`, `cards`, `logs`, `sessions`, `presets`, `revisions` (25 dernières versions par répertoire), `trash` (suppression restaurable), `meta` (jeton GitHub seulement si l’utilisateur le demande). `localStorage` : préférences et sélections de travail. Sauvegarde complète JSON (sans jeton).

## Sécurité

- CSP stricte (`deploy/security-headers.json`, appliquée par Netlify et par `vite preview` pendant les tests) : scripts locaux uniquement + `wasm-unsafe-eval` pour Stockfish.
- Aucun secret dans le code, le build ou le dépôt (vérifié par `tests/deploy.test.ts`).
- Jeton GitHub facultatif, lecture seule, saisi par l’utilisateur, envoyé uniquement à `api.github.com`.
