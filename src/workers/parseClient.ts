import { parsePgn } from '../core/pgn/parse';
import type { ParsedFile } from '../core/pgn/types';

let worker: Worker | null = null;
let seq = 0;
const pending = new Map<number, { resolve: (r: ParsedFile) => void; reject: (e: Error) => void; onProgress?: (d: number, t: number) => void }>();

function getWorker(): Worker | null {
  if (worker) return worker;
  if (typeof Worker === 'undefined') return null;
  try {
    worker = new Worker(new URL('./pgn.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e: MessageEvent<{ id: number; type: string; done?: number; total?: number; result?: ParsedFile; message?: string }>) => {
      const p = pending.get(e.data.id);
      if (!p) return;
      if (e.data.type === 'progress') p.onProgress?.(e.data.done!, e.data.total!);
      else if (e.data.type === 'done') {
        pending.delete(e.data.id);
        p.resolve(e.data.result!);
      } else {
        pending.delete(e.data.id);
        p.reject(new Error(e.data.message ?? 'Erreur d’analyse'));
      }
    };
    worker.onerror = () => {
      // Le worker n'a pas pu démarrer : on bascule sur le fil principal.
      for (const [id, p] of pending) {
        pending.delete(id);
        p.reject(new Error('worker-failed'));
      }
      worker = null;
    };
    return worker;
  } catch {
    return null;
  }
}

/** Analyse un texte PGN dans un Web Worker (repli sur le fil principal si indisponible). */
export async function parseInBackground(text: string, onProgress?: (done: number, total: number) => void): Promise<ParsedFile> {
  const w = getWorker();
  if (w) {
    try {
      return await new Promise<ParsedFile>((resolve, reject) => {
        const id = ++seq;
        pending.set(id, { resolve, reject, onProgress });
        w.postMessage({ id, text });
      });
    } catch (e) {
      if ((e as Error).message !== 'worker-failed') throw e;
    }
  }
  await new Promise((r) => setTimeout(r, 0));
  return parsePgn(text, { onProgress });
}

/** Décode un fichier en UTF-8, avec repli Windows-1252 pour les anciens PGN. */
export async function readPgnFile(file: File): Promise<{ text: string; encoding: string }> {
  const buf = await file.arrayBuffer();
  try {
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(buf), encoding: 'UTF-8' };
  } catch {
    return { text: new TextDecoder('windows-1252').decode(buf), encoding: 'Windows-1252' };
  }
}
