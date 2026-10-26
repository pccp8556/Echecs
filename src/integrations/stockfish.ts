/**
 * Client UCI minimal pour Stockfish 18 (WebAssembly, version légère
 * mono-thread) exécuté dans un Web Worker et chargé uniquement à la demande.
 *
 * Les évaluations sont exprimées du point de vue des Blancs. Rien n'est jamais
 * écrit dans le répertoire : le moteur ne fait qu'informer.
 */
import { Chess } from 'chess.js';

export const ENGINE_URL = `${import.meta.env.BASE_URL}stockfish/stockfish-18-lite-single.js`;

export interface EngineLine {
  multipv: number;
  depth: number;
  /** Centipions du point de vue des Blancs. */
  cp?: number;
  /** Mat en N (positif = les Blancs matent). */
  mate?: number;
  pv: string[];
}

export interface EngineSnapshot {
  fen: string;
  depth: number;
  lines: EngineLine[];
  done: boolean;
  bestmove?: string;
}

type Listener = (s: EngineSnapshot) => void;

export class StockfishEngine {
  private worker: Worker | null = null;
  private readyPromise: Promise<void> | null = null;
  private current: { fen: string; listener: Listener; snapshot: EngineSnapshot; resolve: (s: EngineSnapshot) => void } | null = null;
  private queue: Array<() => void> = [];
  private searching = false;
  status: 'idle' | 'loading' | 'ready' | 'error' = 'idle';
  error?: string;

  init(): Promise<void> {
    if (this.readyPromise) return this.readyPromise;
    this.status = 'loading';
    this.readyPromise = new Promise<void>((resolve, reject) => {
      try {
        if (typeof WebAssembly === 'undefined') throw new Error('WebAssembly n’est pas disponible dans ce navigateur.');
        const w = new Worker(ENGINE_URL);
        this.worker = w;
        let gotUci = false;
        const timer = setTimeout(() => {
          this.status = 'error';
          this.error = 'Le moteur ne répond pas (chargement trop long).';
          reject(new Error(this.error));
        }, 30000);
        w.onmessage = (e: MessageEvent<string>) => {
          const line = typeof e.data === 'string' ? e.data : '';
          if (line === 'uciok') {
            gotUci = true;
            w.postMessage('setoption name MultiPV value 3');
            w.postMessage('isready');
          } else if (line === 'readyok' && gotUci && this.status === 'loading') {
            clearTimeout(timer);
            this.status = 'ready';
            resolve();
          } else this.onLine(line);
        };
        w.onerror = (ev) => {
          clearTimeout(timer);
          this.status = 'error';
          this.error = `Chargement du moteur impossible${ev.message ? ` : ${ev.message}` : ''}.`;
          reject(new Error(this.error));
        };
        w.postMessage('uci');
      } catch (err) {
        this.status = 'error';
        this.error = err instanceof Error ? err.message : String(err);
        reject(err);
      }
    });
    return this.readyPromise;
  }

  private onLine(line: string) {
    const cur = this.current;
    if (!cur) {
      if (line.startsWith('bestmove')) this.finishSearch();
      return;
    }
    if (line.startsWith('info') && line.includes(' pv ')) {
      const depth = Number(/ depth (\d+)/.exec(line)?.[1] ?? 0);
      const multipv = Number(/ multipv (\d+)/.exec(line)?.[1] ?? 1);
      const cp = /score cp (-?\d+)/.exec(line)?.[1];
      const mate = /score mate (-?\d+)/.exec(line)?.[1];
      const pv = line.split(' pv ')[1]?.trim().split(/\s+/) ?? [];
      const whiteToMove = cur.fen.split(' ')[1] === 'w';
      const sign = whiteToMove ? 1 : -1;
      const entry: EngineLine = { multipv, depth, pv, cp: cp != null ? sign * Number(cp) : undefined, mate: mate != null ? sign * Number(mate) : undefined };
      const lines = cur.snapshot.lines.filter((l) => l.multipv !== multipv);
      lines.push(entry);
      lines.sort((a, b) => a.multipv - b.multipv);
      cur.snapshot = { ...cur.snapshot, depth: Math.max(cur.snapshot.depth, depth), lines };
      cur.listener(cur.snapshot);
    } else if (line.startsWith('bestmove')) {
      const best = line.split(' ')[1];
      cur.snapshot = { ...cur.snapshot, done: true, bestmove: best && best !== '(none)' ? best : undefined };
      cur.listener(cur.snapshot);
      cur.resolve(cur.snapshot);
      this.current = null;
      this.finishSearch();
    }
  }

  private finishSearch() {
    this.searching = false;
    const next = this.queue.shift();
    next?.();
  }

  /** Analyse une position ; une nouvelle demande interrompt la précédente. */
  async analyse(fen: string, opts: { depth: number; multipv?: number }, listener: Listener): Promise<EngineSnapshot> {
    await this.init();
    const w = this.worker!;
    return new Promise<EngineSnapshot>((resolve) => {
      const start = () => {
        this.searching = true;
        this.current = { fen, listener, resolve, snapshot: { fen, depth: 0, lines: [], done: false } };
        w.postMessage(`setoption name MultiPV value ${opts.multipv ?? 3}`);
        w.postMessage(`position fen ${fen}`);
        w.postMessage(`go depth ${opts.depth}`);
      };
      if (this.searching) {
        // Interrompt la recherche en cours ; la nouvelle démarre à la réception de « bestmove ».
        const prev = this.current;
        if (prev) prev.resolve({ ...prev.snapshot, done: true });
        this.current = null;
        this.queue = [start];
        w.postMessage('stop');
      } else start();
    });
  }

  stop() {
    if (this.searching) this.worker?.postMessage('stop');
  }

  destroy() {
    this.worker?.terminate();
    this.worker = null;
    this.readyPromise = null;
    this.status = 'idle';
  }
}

let shared: StockfishEngine | null = null;
export function getEngine(): StockfishEngine {
  if (!shared) shared = new StockfishEngine();
  return shared;
}

/** Convertit une variante UCI en SAN depuis une position. */
export function pvToSan(fen: string, pv: string[], max = 10): string[] {
  const chess = new Chess(fen);
  const out: string[] = [];
  for (const u of pv.slice(0, max)) {
    try {
      const m = chess.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] });
      out.push(m.san);
    } catch {
      break;
    }
  }
  return out;
}

export function formatEval(line: Pick<EngineLine, 'cp' | 'mate'> | undefined): string {
  if (!line) return '…';
  if (line.mate != null) return line.mate > 0 ? `#${line.mate}` : `#-${Math.abs(line.mate)}`;
  if (line.cp == null) return '…';
  const v = line.cp / 100;
  return `${v > 0 ? '+' : ''}${v.toFixed(2)}`;
}

/** Part (0–1) de la barre d'évaluation revenant aux Blancs. */
export function evalShare(line: Pick<EngineLine, 'cp' | 'mate'> | undefined): number {
  if (!line) return 0.5;
  if (line.mate != null) return line.mate > 0 ? 1 : 0;
  const cp = line.cp ?? 0;
  return 1 / (1 + Math.exp(-cp / 250));
}
