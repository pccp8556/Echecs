import cburnettRaw from '../../assets/pieces/cburnett.svg?raw';
import stauntyRaw from '../../assets/pieces/staunty.svg?raw';

export type PieceSetId = 'cburnett' | 'staunty';

export const PIECE_SETS: Record<PieceSetId, { label: string; credit: string; license: string }> = {
  cburnett: {
    label: 'Classique (Cburnett)',
    credit: 'Colin M. L. Burnett, via Wikimedia Commons, adapté par Stefan Haack (cm-chessboard)',
    license: 'CC BY-SA 3.0',
  },
  staunty: {
    label: 'Staunty',
    credit: 'Jeu « Staunty » du projet Lichess (lila, voir COPYING.md), adapté par Stefan Haack (cm-chessboard)',
    license: 'CC BY-NC-SA 4.0 (usage non commercial)',
  },
};

const PIECE_IDS = ['wk', 'wq', 'wr', 'wb', 'wn', 'wp', 'bk', 'bq', 'br', 'bb', 'bn', 'bp'];

/** Extrait le contenu d'un sprite et préfixe les identifiants des pièces. */
function prepareSprite(raw: string, prefix: string): string {
  const start = raw.indexOf('>', raw.indexOf('<svg')) + 1;
  const end = raw.lastIndexOf('</svg>');
  let inner = raw.slice(start, end);
  inner = inner.replace(/<!--[\s\S]*?-->/g, '').replace(/<title>[\s\S]*?<\/title>/g, '');
  inner = inner.replace(/\sid="([^"]+)"/g, (_m, id: string) => (PIECE_IDS.includes(id) ? ` id="${prefix}-${id}"` : ''));
  return inner;
}

const SPRITES = `${prepareSprite(cburnettRaw, 'cburnett')}${prepareSprite(stauntyRaw, 'staunty')}`;

/** Définitions SVG des pièces, injectées une seule fois dans le document. */
export function PieceSprites() {
  return (
    <svg aria-hidden="true" width="0" height="0" style={{ position: 'absolute', width: 0, height: 0, overflow: 'hidden' }}>
      <defs dangerouslySetInnerHTML={{ __html: SPRITES }} />
    </svg>
  );
}

export function PieceSvg({ set, piece, className }: { set: PieceSetId; piece: string; className?: string }) {
  return (
    <svg viewBox="0 0 40 40" className={className} aria-hidden="true" focusable="false">
      <use href={`#${set}-${piece}`} />
    </svg>
  );
}

export const PIECE_NAMES_FR: Record<string, string> = { k: 'Roi', q: 'Dame', r: 'Tour', b: 'Fou', n: 'Cavalier', p: 'Pion' };
