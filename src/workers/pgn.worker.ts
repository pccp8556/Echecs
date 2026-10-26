import { parsePgn } from '../core/pgn/parse';

/** Analyse PGN hors du fil principal pour ne pas bloquer l'interface sur les gros fichiers. */
const ctx = self as unknown as { postMessage(m: unknown): void; onmessage: ((e: MessageEvent<{ id: number; text: string }>) => void) | null };

ctx.onmessage = (e: MessageEvent<{ id: number; text: string }>) => {
  const { id, text } = e.data;
  let last = 0;
  try {
    const result = parsePgn(text, {
      onProgress: (done, total) => {
        const now = Date.now();
        if (now - last > 80 || done === total) {
          last = now;
          ctx.postMessage({ id, type: 'progress', done, total });
        }
      },
    });
    ctx.postMessage({ id, type: 'done', result });
  } catch (err) {
    ctx.postMessage({ id, type: 'error', message: err instanceof Error ? err.message : String(err) });
  }
};
