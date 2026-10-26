# Application Android

## Solution retenue

**Capacitor 8** : l’application web (même code que la version navigateur) est embarquée dans une application Android native. Elle fonctionne entièrement hors ligne : les fichiers de l’application et Stockfish sont dans l’APK, les données sont dans la WebView (IndexedDB) de l’application.

Une **PWA** installable existe aussi (Chrome → *Installer l’application*), mais ce n’est pas un APK : c’est un raccourci vers le site, avec ses données propres au navigateur.

| Élément | Valeur |
| --- | --- |
| Identifiant | `io.github.pccp8556.paulauraittrouve` |
| Android minimum | 7.0 (SDK 24) |
| Cible / compilation | Android 16 (SDK 36) |
| Permissions | `INTERNET` uniquement (import GitHub / URL) |
| Version | `versionName 1.0.0`, `versionCode 1` (`android/app/build.gradle`) |

Adaptations natives (`src/native.ts`) :
- l’export (PGN, sauvegarde, statistiques) passe par la **feuille de partage Android** (Enregistrer dans Fichiers, Drive, e-mail…) via `@capacitor/filesystem` et `@capacitor/share`, car les téléchargements par lien n’existent pas dans la WebView ;
- pas de service worker dans l’application (les fichiers sont déjà locaux) ;
- l’import de fichier utilise le sélecteur de fichiers Android standard.

## Générer l’APK de débogage

Prérequis : JDK 21, Android SDK avec `platforms;android-36`, `build-tools;36.0.0`, `platform-tools`, et `ANDROID_HOME` défini (ou `android/local.properties` avec `sdk.dir=…`).

```bash
npm ci
npm run build
npx cap sync android
cd android && ./gradlew assembleDebug
# APK : android/app/build/outputs/apk/debug/app-debug.apk
```

Raccourci : `npm run android:apk`.

Sans environnement local : onglet **Actions** du dépôt GitHub → workflow **Android APK** → artefact `paul-aurait-trouve-debug-apk`.

## Installer sur un téléphone

1. Copie l’APK sur le téléphone (ou télécharge l’artefact).
2. Ouvre-le ; Android demande d’autoriser l’installation depuis cette source (*Paramètres → Applications → Accès spécial → Installer des applications inconnues*).
3. Installe, puis ouvre **Paul aurait trouvé** et importe ton PGN depuis le téléphone ou GitHub.

L’APK de débogage est signé avec une clé de débogage générique : pour mettre à jour une installation existante, il faut un APK signé avec la **même** clé.

## Données

Les données restent dans l’application. Désinstaller l’application les efface. Avant une réinstallation ou un changement de téléphone : *Réglages → Données → Exporter une sauvegarde complète*, puis *Restaurer* sur le nouvel appareil. `android:allowBackup` est activé : la sauvegarde automatique Android peut aussi conserver les données de l’application.

## Version signée (publication)

1. Crée une clé (à conserver précieusement, hors du dépôt) :
   ```bash
   keytool -genkeypair -v -keystore paul-release.keystore -alias paul -keyalg RSA -keysize 4096 -validity 10000
   ```
2. Build local signé :
   ```bash
   export ANDROID_KEYSTORE_PATH=$PWD/paul-release.keystore
   export ANDROID_KEYSTORE_PASSWORD=…  ANDROID_KEY_ALIAS=paul  ANDROID_KEY_PASSWORD=…
   cd android && ./gradlew assembleRelease bundleRelease
   ```
   → `app/build/outputs/apk/release/app-release.apk` et `app/build/outputs/bundle/release/app-release.aab`.
3. Ou par GitHub Actions : ajoute les secrets `ANDROID_KEYSTORE_BASE64` (`base64 -w0 paul-release.keystore`), `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD` ; le workflow produit alors aussi l’APK et l’AAB signés.

Aucun mot de passe ni clé n’est écrit dans le dépôt : `android/app/build.gradle` lit uniquement des variables d’environnement.

## Préparer le Play Store (facultatif)

- Publier l’**AAB** signé (`bundleRelease`), avec une fiche : nom, description courte/longue, icône 512 px (`public/icons/icon-512.png`), image de présentation 1024×500, captures (`docs/screenshots/`).
- Incrémenter `versionCode` à chaque publication.
- Déclarer la collecte de données : aucune (tout reste sur l’appareil ; l’accès réseau sert uniquement à l’import GitHub/URL demandé par l’utilisateur).
- Licences : Stockfish est sous GPL-3.0 (proposer l’accès au code source correspondant, cf. `public/stockfish/SOURCE.md`) ; le jeu de pièces « Staunty » est sous licence **non commerciale** — pour une application payante, utiliser uniquement « Cburnett ».

## Ce qui a été vérifié et ce qui reste à vérifier

- Vérifié dans l’environnement de développement : build Gradle réussi, APK valide (`aapt2 dump badging`, `apksigner verify`), contenu web et Stockfish présents dans l’APK.
- **Non vérifié** (pas d’émulateur ni d’appareil disponible lors du build) : exécution sur un téléphone, interactions tactiles natives, partage de fichiers. Les interactions tactiles et l’adaptation de l’échiquier ont été testées dans Chromium en émulation mobile (Pixel 7).
