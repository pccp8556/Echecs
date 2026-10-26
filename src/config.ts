export const APP_NAME = 'Paul aurait trouvé';
export const APP_TAGLINE = 'Révision d’ouvertures';
export const APP_VERSION = (import.meta.env.VITE_APP_VERSION as string | undefined) ?? '1.0.0';
/** Dépôt GitHub proposé par défaut dans l'import (public). Configurable via VITE_DEFAULT_GITHUB_REPO. */
export const DEFAULT_GITHUB_REPO = (import.meta.env.VITE_DEFAULT_GITHUB_REPO as string | undefined) ?? 'pccp8556/Echecs';
/** Préversion hébergée sur claude.ai : pas de service worker, de téléchargement ni d'accès réseau externe. */
export const IS_ARTIFACT_PREVIEW = import.meta.env.VITE_PREVIEW_HOST === 'artifact';
