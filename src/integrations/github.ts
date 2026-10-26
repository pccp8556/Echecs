/**
 * Lecture de fichiers PGN sur GitHub, directement depuis le navigateur.
 *
 * - Dépôt public : API REST GitHub sans authentification (60 requêtes/heure),
 *   avec repli sur raw.githubusercontent.com.
 * - Dépôt privé : jeton d'accès personnel « fine-grained » saisi par
 *   l'utilisateur, en lecture seule (permission « Contents: Read-only » sur le
 *   seul dépôt concerné). Le jeton n'est jamais intégré au code ni exporté ; il
 *   n'est envoyé qu'à api.github.com.
 *
 * L'écriture vers GitHub n'est volontairement pas implémentée.
 */

export interface GithubRef {
  owner: string;
  repo: string;
  ref?: string;
  path?: string;
}

export interface GithubFile {
  path: string;
  sha: string;
  size: number;
}

export interface FetchedFile {
  text: string;
  sha?: string;
  size: number;
  htmlUrl: string;
  rawUrl: string;
  ref: string;
  private?: boolean;
}

export class GithubError extends Error {
  constructor(
    message: string,
    public status?: number,
  ) {
    super(message);
  }
}

const API = 'https://api.github.com';

/** Analyse « owner/repo », une URL github.com (blob/tree) ou raw.githubusercontent.com. */
export function parseGithubInput(input: string): GithubRef | null {
  const s = input.trim().replace(/\.git$/, '');
  if (!s) return null;
  let m = /^https?:\/\/raw\.githubusercontent\.com\/([^/]+)\/([^/]+)\/([^/]+)\/(.+)$/.exec(s);
  if (m) return { owner: m[1], repo: m[2], ref: m[3], path: decodeURIComponent(m[4]) };
  m = /^https?:\/\/(?:www\.)?github\.com\/([^/]+)\/([^/?#]+)(?:\/(blob|tree|raw)\/([^/]+)(?:\/(.+?))?)?\/?(?:[?#].*)?$/.exec(s);
  if (m) return { owner: m[1], repo: m[2], ref: m[4], path: m[5] ? decodeURIComponent(m[5]) : undefined };
  m = /^([A-Za-z0-9-_.]+)\/([A-Za-z0-9-_.]+)$/.exec(s);
  if (m) return { owner: m[1], repo: m[2] };
  return null;
}

function headers(token?: string): HeadersInit {
  const h: Record<string, string> = { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

async function api<T>(path: string, token?: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API}${path}`, { headers: headers(token) });
  } catch {
    throw new GithubError('Impossible de joindre GitHub (hors ligne ou réseau bloqué).');
  }
  if (res.ok) return (await res.json()) as T;
  const remaining = res.headers.get('x-ratelimit-remaining');
  if ((res.status === 403 || res.status === 429) && remaining === '0') {
    throw new GithubError('Limite de requêtes GitHub atteinte (60 par heure sans jeton). Réessaie plus tard ou ajoute un jeton en lecture seule dans les réglages.', res.status);
  }
  if (res.status === 401) throw new GithubError('Jeton GitHub refusé (expiré ou invalide).', 401);
  if (res.status === 404)
    throw new GithubError(
      token
        ? 'Introuvable : vérifie le nom du dépôt, la branche et que le jeton a accès à ce dépôt.'
        : 'Introuvable : le dépôt est peut-être privé. Pour un dépôt privé, ajoute un jeton en lecture seule dans les réglages.',
      404,
    );
  throw new GithubError(`GitHub a répondu ${res.status}.`, res.status);
}

export async function repoInfo(owner: string, repo: string, token?: string): Promise<{ defaultBranch: string; private: boolean }> {
  const r = await api<{ default_branch: string; private: boolean }>(`/repos/${owner}/${repo}`, token);
  return { defaultBranch: r.default_branch, private: r.private };
}

/** Liste les fichiers .pgn d'un dépôt (arborescence complète de la branche). */
export async function listPgnFiles(ref: GithubRef, token?: string): Promise<{ files: GithubFile[]; ref: string; private: boolean }> {
  const info = await repoInfo(ref.owner, ref.repo, token);
  const branch = ref.ref ?? info.defaultBranch;
  const tree = await api<{ tree: Array<{ path: string; type: string; sha: string; size?: number }>; truncated: boolean }>(
    `/repos/${ref.owner}/${ref.repo}/git/trees/${encodeURIComponent(branch)}?recursive=1`,
    token,
  );
  const prefix = ref.path ? ref.path.replace(/\/$/, '') + '/' : '';
  const files = tree.tree
    .filter((t) => t.type === 'blob' && /\.pgn$/i.test(t.path) && (!prefix || t.path.startsWith(prefix) || t.path === ref.path))
    .map((t) => ({ path: t.path, sha: t.sha, size: t.size ?? 0 }));
  return { files, ref: branch, private: info.private };
}

function decodeBase64Utf8(b64: string): string {
  const bin = atob(b64.replace(/\s/g, ''));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder('windows-1252').decode(bytes);
  }
}

/** Télécharge un fichier et son SHA Git (pour détecter plus tard une modification distante). */
export async function fetchGithubFile(ref: GithubRef & { path: string }, token?: string): Promise<FetchedFile> {
  const branch = ref.ref ?? (await repoInfo(ref.owner, ref.repo, token)).defaultBranch;
  const encodedPath = ref.path.split('/').map(encodeURIComponent).join('/');
  const rawUrl = `https://raw.githubusercontent.com/${ref.owner}/${ref.repo}/${branch}/${encodedPath}`;
  const htmlUrl = `https://github.com/${ref.owner}/${ref.repo}/blob/${branch}/${encodedPath}`;
  try {
    const meta = await api<{ sha: string; size: number; content?: string; encoding?: string }>(
      `/repos/${ref.owner}/${ref.repo}/contents/${encodedPath}?ref=${encodeURIComponent(branch)}`,
      token,
    );
    let text: string;
    if (meta.content && meta.encoding === 'base64') text = decodeBase64Utf8(meta.content);
    else {
      // Fichiers de plus de 1 Mo : contenu via l'API des blobs.
      const blob = await api<{ content: string; encoding: string }>(`/repos/${ref.owner}/${ref.repo}/git/blobs/${meta.sha}`, token);
      text = decodeBase64Utf8(blob.content);
    }
    return { text, sha: meta.sha, size: meta.size, htmlUrl, rawUrl, ref: branch };
  } catch (e) {
    // Repli sans API (limite atteinte) : uniquement pour les dépôts publics.
    if (!token && e instanceof GithubError && (e.status === 403 || e.status === 429)) {
      const text = await fetchUrlText(rawUrl);
      return { text, size: text.length, htmlUrl, rawUrl, ref: branch };
    }
    throw e;
  }
}

/** SHA actuel d'un fichier distant, sans télécharger son contenu complet. */
export async function remoteSha(ref: GithubRef & { path: string }, token?: string): Promise<string> {
  const encodedPath = ref.path.split('/').map(encodeURIComponent).join('/');
  const meta = await api<{ sha: string }>(`/repos/${ref.owner}/${ref.repo}/contents/${encodedPath}${ref.ref ? `?ref=${encodeURIComponent(ref.ref)}` : ''}`, token);
  return meta.sha;
}

/** Téléchargement d'une URL brute (le serveur doit autoriser CORS). */
export async function fetchUrlText(url: string): Promise<string> {
  let res: Response;
  try {
    res = await fetch(url, { headers: { Accept: 'text/plain, application/x-chess-pgn, */*' } });
  } catch {
    throw new GithubError('Téléchargement impossible : hors ligne, ou le serveur n’autorise pas l’accès depuis un navigateur (CORS). Télécharge le fichier puis importe-le depuis ton appareil.');
  }
  if (!res.ok) throw new GithubError(`Le serveur a répondu ${res.status}.`, res.status);
  const buf = await res.arrayBuffer();
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf);
  } catch {
    return new TextDecoder('windows-1252').decode(buf);
  }
}

/** Convertit une URL github.com/blob en URL brute téléchargeable. */
export function toRawUrl(url: string): string {
  const r = parseGithubInput(url);
  if (r && r.path && r.ref) return `https://raw.githubusercontent.com/${r.owner}/${r.repo}/${r.ref}/${r.path.split('/').map(encodeURIComponent).join('/')}`;
  return url;
}

/* ---------------- Jeton (optionnel, dépôts privés) ---------------- */

let sessionToken: string | null = null;

export async function getToken(): Promise<string | undefined> {
  if (sessionToken) return sessionToken;
  try {
    const { getMeta } = await import('../storage/repo');
    const t = await getMeta<string>('github.token');
    if (t) sessionToken = t;
    return t ?? undefined;
  } catch {
    return undefined;
  }
}

export async function setToken(token: string | null, remember: boolean): Promise<void> {
  sessionToken = token;
  const { setMeta, deleteMeta } = await import('../storage/repo');
  if (token && remember) await setMeta('github.token', token);
  else await deleteMeta('github.token');
}

export async function whoAmI(token: string): Promise<string> {
  const me = await api<{ login: string }>('/user', token);
  return me.login;
}
