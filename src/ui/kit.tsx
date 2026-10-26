import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { create } from 'zustand';
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from 'lucide-react';
import type { MasteryLevel } from '../core/srs/srs';
import { MASTERY_LABELS } from '../core/srs/srs';
import { isNative, shareTextFile } from '../native';

/* ---------------- Notifications ---------------- */

export interface Toast {
  id: number;
  kind: 'success' | 'error' | 'info';
  title: string;
  message?: string;
}

interface ToastStore {
  toasts: Toast[];
  push: (t: Omit<Toast, 'id'>, ms?: number) => void;
  dismiss: (id: number) => void;
}

let toastSeq = 0;
export const useToasts = create<ToastStore>((set, get) => ({
  toasts: [],
  push: (t, ms = 4200) => {
    const id = ++toastSeq;
    set({ toasts: [...get().toasts, { ...t, id }] });
    window.setTimeout(() => get().dismiss(id), ms);
  },
  dismiss: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),
}));

export const toast = {
  success: (title: string, message?: string) => useToasts.getState().push({ kind: 'success', title, message }),
  error: (title: string, message?: string) => useToasts.getState().push({ kind: 'error', title, message }, 7000),
  info: (title: string, message?: string) => useToasts.getState().push({ kind: 'info', title, message }),
};

export function Toasts() {
  const { toasts, dismiss } = useToasts();
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast toast-${t.kind}`}>
          {t.kind === 'success' ? <CheckCircle2 /> : t.kind === 'error' ? <XCircle /> : <Info />}
          <div className="toast-body">
            <div className="toast-title">{t.title}</div>
            {t.message && <div className="toast-msg">{t.message}</div>}
          </div>
          <button className="btn btn-ghost btn-icon btn-sm" aria-label="Fermer" onClick={() => dismiss(t.id)}>
            <X />
          </button>
        </div>
      ))}
    </div>
  );
}

/* ---------------- Modale ---------------- */

export function Modal({ title, children, footer, onClose, wide, describedBy }: { title: string; children: ReactNode; footer?: ReactNode; onClose: () => void; wide?: boolean; describedBy?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const el = ref.current;
    const first = el?.querySelector<HTMLElement>('input, textarea, select, button:not([data-close])');
    (first ?? el)?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'Tab' && el) {
        const items = [...el.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')].filter((x) => !x.hasAttribute('disabled'));
        if (!items.length) return;
        const firstEl = items[0];
        const last = items[items.length - 1];
        if (e.shiftKey && document.activeElement === firstEl) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          firstEl.focus();
        }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      prev?.focus?.();
    };
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} className={`modal ${wide ? 'modal-wide' : ''}`} role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={describedBy} tabIndex={-1}>
        <div className="modal-header">
          <h2 id={titleId}>{title}</h2>
          <button className="btn btn-ghost btn-icon btn-sm" aria-label="Fermer" data-close onClick={onClose}>
            <X />
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-footer">{footer}</div>}
      </div>
    </div>
  );
}

/* ---------------- Confirmations & saisies ---------------- */

interface DialogRequest {
  kind: 'confirm' | 'prompt';
  title: string;
  message?: ReactNode;
  confirmLabel?: string;
  danger?: boolean;
  label?: string;
  defaultValue?: string;
  /** Texte à retaper pour confirmer une action irréversible. */
  typeToConfirm?: string;
  resolve: (v: string | boolean | null) => void;
}

const useDialogStore = create<{ current: DialogRequest | null; set: (d: DialogRequest | null) => void }>((set) => ({
  current: null,
  set: (d) => set({ current: d }),
}));

export function confirmDialog(opts: { title: string; message?: ReactNode; confirmLabel?: string; danger?: boolean; typeToConfirm?: string }): Promise<boolean> {
  return new Promise((resolve) => useDialogStore.getState().set({ kind: 'confirm', ...opts, resolve: (v) => resolve(v === true) }));
}

export function promptDialog(opts: { title: string; label: string; defaultValue?: string; confirmLabel?: string; message?: ReactNode }): Promise<string | null> {
  return new Promise((resolve) => useDialogStore.getState().set({ kind: 'prompt', ...opts, resolve: (v) => resolve(typeof v === 'string' ? v : null) }));
}

export function DialogHost() {
  const { current, set } = useDialogStore();
  const [value, setValue] = useState('');
  useEffect(() => {
    setValue(current?.kind === 'prompt' ? current.defaultValue ?? '' : '');
  }, [current]);
  if (!current) return null;
  const close = (v: string | boolean | null) => {
    current.resolve(v);
    set(null);
  };
  const blocked = current.kind === 'confirm' && current.typeToConfirm != null && value.trim() !== current.typeToConfirm;
  return (
    <Modal
      title={current.title}
      onClose={() => close(current.kind === 'confirm' ? false : null)}
      footer={
        <>
          <button className="btn btn-ghost" onClick={() => close(current.kind === 'confirm' ? false : null)}>
            Annuler
          </button>
          <button
            className={`btn ${current.danger ? 'btn-danger' : 'btn-primary'}`}
            disabled={blocked || (current.kind === 'prompt' && !value.trim())}
            onClick={() => close(current.kind === 'confirm' ? true : value.trim())}
          >
            {current.confirmLabel ?? (current.kind === 'confirm' ? 'Confirmer' : 'Valider')}
          </button>
        </>
      }
    >
      {current.danger && (
        <div className="notice notice-danger">
          <AlertTriangle />
          <div>{current.message}</div>
        </div>
      )}
      {!current.danger && current.message && <div className="muted">{current.message}</div>}
      {current.kind === 'prompt' && (
        <div className="field">
          <label htmlFor="dlg-input">{current.label}</label>
          <input
            id="dlg-input"
            className="input"
            value={value}
            autoFocus
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && value.trim() && close(value.trim())}
          />
        </div>
      )}
      {current.kind === 'confirm' && current.typeToConfirm != null && (
        <div className="field">
          <label htmlFor="dlg-confirm">Tape « {current.typeToConfirm} » pour confirmer</label>
          <input id="dlg-confirm" className="input" value={value} autoFocus onChange={(e) => setValue(e.target.value)} />
        </div>
      )}
    </Modal>
  );
}

/* ---------------- Petits composants ---------------- */

export function Switch({ checked, onChange, label, hint, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode; hint?: ReactNode; disabled?: boolean }) {
  return (
    <label className="switch" style={disabled ? { opacity: 0.5, cursor: 'not-allowed' } : undefined}>
      <input type="checkbox" role="switch" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span className="switch-track" aria-hidden="true" />
      <span className="switch-text">
        {label}
        {hint && <small>{hint}</small>}
      </span>
    </label>
  );
}

export function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: Array<{ value: T; label: ReactNode; icon?: ReactNode; title?: string }>; onChange: (v: T) => void; label: string }) {
  return (
    <div className="segmented" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" aria-pressed={value === o.value} title={o.title} onClick={() => onChange(o.value)}>
          {o.icon}
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Tabs<T extends string>({ value, tabs, onChange, label }: { value: T; tabs: Array<{ value: T; label: ReactNode; icon?: ReactNode; count?: number }>; onChange: (v: T) => void; label: string }) {
  return (
    <div className="tabs" role="tablist" aria-label={label}>
      {tabs.map((t) => (
        <button key={t.value} role="tab" type="button" aria-selected={value === t.value} onClick={() => onChange(t.value)}>
          {t.icon}
          {t.label}
          {t.count != null && <span className="badge">{t.count}</span>}
        </button>
      ))}
    </div>
  );
}

export function EmptyState({ icon, title, children, action }: { icon: ReactNode; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      <div className="empty-icon">{icon}</div>
      <h3>{title}</h3>
      {children && <p>{children}</p>}
      {action}
    </div>
  );
}

export function Loading({ label = 'Chargement…' }: { label?: string }) {
  return (
    <div className="loading-screen" role="status">
      <div className="spinner" />
      <span>{label}</span>
    </div>
  );
}

export function Menu({ trigger, children, label }: { trigger: (open: () => void, isOpen: boolean) => ReactNode; children: (close: () => void) => ReactNode; label: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);
  return (
    <div className="menu-wrap" ref={ref}>
      {trigger(() => setOpen((o) => !o), open)}
      {open && (
        <div className="menu" role="menu" aria-label={label}>
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}

export function MasteryBar({ counts, total }: { counts: Record<MasteryLevel, number>; total: number }) {
  const order: MasteryLevel[] = ['mastered', 'solid', 'learning', 'fragile'];
  const label = order.map((l) => `${MASTERY_LABELS[l]} : ${counts[l]}`).join(', ');
  return (
    <div className="mastery-bar" role="img" aria-label={`Maîtrise — ${label}, nouvelles : ${counts.new}`}>
      {order.map((l) => (counts[l] ? <span key={l} className={`m-${l}`} style={{ width: `${(counts[l] / Math.max(1, total)) * 100}%` }} /> : null))}
    </div>
  );
}

export function MasteryLegend() {
  return (
    <div className="legend">
      <span>
        <i className="m-mastered" /> Maîtrisée
      </span>
      <span>
        <i className="m-solid" /> Solide
      </span>
      <span>
        <i className="m-learning" /> En apprentissage
      </span>
      <span>
        <i className="m-fragile" /> Fragile
      </span>
      <span>
        <i className="m-new" style={{ border: '1px solid var(--border-strong)' }} /> Nouvelle
      </span>
    </div>
  );
}

export function Ring({ value, size = 64, label }: { value: number | null; size?: number; label: string }) {
  const p = value == null ? 0 : Math.round(value * 100);
  return (
    <div className="ring" style={{ ['--p' as string]: p, ['--size' as string]: `${size}px` }} role="img" aria-label={`${label} : ${value == null ? 'pas encore de données' : `${p} %`}`}>
      <span>{value == null ? '—' : `${p}%`}</span>
    </div>
  );
}

export function ColorDot({ color }: { color: 'w' | 'b' | 'both' }) {
  return <span className={`color-dot ${color}`} aria-hidden="true" />;
}

export function formatDuration(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s} s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return `${h} h ${String(m % 60).padStart(2, '0')}`;
}

export function formatRelative(ts: number | undefined, now = Date.now()): string {
  if (!ts) return 'jamais';
  const d = now - ts;
  if (d < 60000) return 'à l’instant';
  if (d < 3600000) return `il y a ${Math.round(d / 60000)} min`;
  if (d < 86400000) return `il y a ${Math.round(d / 3600000)} h`;
  const days = Math.round(d / 86400000);
  if (days === 1) return 'hier';
  if (days < 30) return `il y a ${days} jours`;
  return new Date(ts).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function pct(v: number | null | undefined, digits = 0): string {
  if (v == null || Number.isNaN(v)) return '—';
  return `${(v * 100).toFixed(digits)} %`;
}

export async function copyText(text: string, what = 'Copié'): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(what);
  } catch {
    toast.error('Copie impossible', 'Le presse-papiers n’est pas accessible dans ce contexte.');
  }
}

export function downloadText(name: string, text: string, mime = 'application/x-chess-pgn') {
  if (isNative()) {
    shareTextFile(name, text, mime).catch((e) => toast.error('Export impossible', e instanceof Error ? e.message : String(e)));
    return;
  }
  const blob = new Blob([text], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
