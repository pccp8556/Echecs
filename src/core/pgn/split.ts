/**
 * Découpage d'un fichier PGN en parties, tolérant aux formats imparfaits
 * (absence de ligne vide, parties sans en-têtes, commentaires contenant des
 * crochets, lignes d'échappement « % »…). On ne modifie jamais le texte d'une
 * partie : chaque morceau correspond exactement à une portion du fichier.
 */

export interface GameChunk {
  text: string;
  /** Décalage (en caractères) du début de la partie dans le fichier normalisé. */
  offset: number;
  /** Ligne (1-based) du début de la partie. */
  line: number;
}

const RESULT_RE = /^(1-0|0-1|1\/2-1\/2|\*)$/;

/** Normalise les fins de ligne et retire l'éventuel BOM. */
export function normalizeText(text: string): string {
  return text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
}

export function splitGames(input: string): GameChunk[] {
  const text = normalizeText(input);
  const chunks: GameChunk[] = [];
  const n = text.length;
  let i = 0;
  let line = 1;
  let gameStart = -1;
  let gameLine = 1;
  let sawMoves = false; // du texte de coups depuis le début de la partie courante
  let ended = false; // un résultat a été lu au niveau 0
  let depth = 0;
  let atLineStart = true;

  const close = (end: number) => {
    if (gameStart >= 0) {
      const t = text.slice(gameStart, end);
      if (t.trim()) chunks.push({ text: t.replace(/\s+$/, '') + '\n', offset: gameStart, line: gameLine });
    }
    gameStart = -1;
    sawMoves = false;
    ended = false;
    depth = 0;
  };
  const open = (pos: number) => {
    gameStart = pos;
    gameLine = line;
  };

  while (i < n) {
    const ch = text[i];
    if (ch === '\n') {
      line++;
      i++;
      atLineStart = true;
      continue;
    }
    if (atLineStart && ch === '%') {
      // Ligne d'échappement : ignorée jusqu'à la fin de ligne.
      while (i < n && text[i] !== '\n') i++;
      continue;
    }
    atLineStart = false;
    if (ch === ' ' || ch === '\t') {
      i++;
      continue;
    }
    if (ch === '{') {
      if (gameStart < 0) open(i);
      else if (ended) {
        close(i);
        open(i);
      }
      sawMoves = true;
      const end = text.indexOf('}', i + 1);
      const stop = end < 0 ? n : end + 1;
      for (let k = i; k < stop; k++) if (text[k] === '\n') line++;
      i = stop;
      continue;
    }
    if (ch === ';') {
      while (i < n && text[i] !== '\n') i++;
      continue;
    }
    if (ch === '[' && depth === 0) {
      // Une paire d'en-tête. Si des coups ont déjà été lus, une nouvelle partie commence.
      if (gameStart >= 0 && sawMoves) close(i);
      if (gameStart < 0) open(i);
      // Lit jusqu'au « ] » en respectant les chaînes entre guillemets.
      let k = i + 1;
      let inStr = false;
      while (k < n) {
        const c = text[k];
        if (inStr) {
          if (c === '\\') k++;
          else if (c === '"') inStr = false;
        } else if (c === '"') inStr = true;
        else if (c === ']' || c === '\n') break;
        k++;
      }
      i = k < n && text[k] === ']' ? k + 1 : k;
      continue;
    }
    // Jeton de coups
    if (gameStart < 0) open(i);
    else if (ended) {
      close(i);
      open(i);
    }
    if (ch === '(') {
      depth++;
      sawMoves = true;
      i++;
      continue;
    }
    if (ch === ')') {
      depth = Math.max(0, depth - 1);
      i++;
      continue;
    }
    let k = i;
    while (k < n && !/[\s{}();[\]]/.test(text[k])) k++;
    if (k === i) k = i + 1;
    const token = text.slice(i, k);
    sawMoves = true;
    if (depth === 0 && RESULT_RE.test(token)) ended = true;
    i = k;
  }
  close(n);
  return chunks;
}

/**
 * Prépare le texte d'une partie pour l'analyseur : retire les lignes « % »,
 * convertit les roques écrits avec des zéros (0-0) et les symboles d'annotation
 * Unicode que l'analyseur ne connaît pas. Les commentaires ne sont pas modifiés.
 */
export function prepareForParser(text: string): string {
  let out = '';
  const n = text.length;
  let i = 0;
  let atLineStart = true;
  while (i < n) {
    const ch = text[i];
    if (atLineStart && ch === '%') {
      while (i < n && text[i] !== '\n') i++;
      continue;
    }
    if (ch === '\n') {
      atLineStart = true;
      out += ch;
      i++;
      continue;
    }
    atLineStart = false;
    if (ch === '{') {
      const end = text.indexOf('}', i + 1);
      const stop = end < 0 ? n : end + 1;
      out += text.slice(i, stop);
      i = stop;
      continue;
    }
    if (ch === '[') {
      const end = text.indexOf(']', i + 1);
      const stop = end < 0 ? n : end + 1;
      out += text.slice(i, stop);
      i = stop;
      continue;
    }
    if (ch === ';') {
      // Commentaire de fin de ligne : converti en commentaire {…} pour l'analyseur.
      let k = i + 1;
      while (k < n && text[k] !== '\n') k++;
      const c = text.slice(i + 1, k).replace(/[{}]/g, '');
      out += `{${c}}`;
      i = k;
      continue;
    }
    let k = i;
    while (k < n && !/[\s{}();[\]]/.test(text[k])) k++;
    if (k === i) {
      out += ch;
      i++;
      continue;
    }
    let token = text.slice(i, k);
    // Numéro collé au roque : « 5.0-0 »
    token = token.replace(/^(\d+\.+)?0-0-0/, (_, num: string | undefined) => (num ?? '') + 'O-O-O');
    token = token.replace(/^(\d+\.+)?0-0(?!-)/, (_, num: string | undefined) => (num ?? '') + 'O-O');
    token = token.replace(/^(\d+\.+)?o-o-o/, (_, num: string | undefined) => (num ?? '') + 'O-O-O');
    token = token.replace(/^(\d+\.+)?o-o(?!-)/, (_, num: string | undefined) => (num ?? '') + 'O-O');
    out += token;
    i = k;
  }
  return out;
}

/** Lecture rapide des en-têtes, utilisable même quand l'analyse complète échoue. */
export function quickHeaders(text: string): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  const re = /^\s*\[\s*([A-Za-z0-9_]+)\s+"((?:[^"\\]|\\.)*)"\s*\]/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) out.push([m[1], m[2].replace(/\\(["\\])/g, '$1')]);
  return out;
}
