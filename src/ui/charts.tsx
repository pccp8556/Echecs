import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Table2, BarChart3 } from 'lucide-react';

/* Graphiques SVG légers : barres fines arrondies côté données, grille en filet,
   infobulle au survol, légende pour plusieurs séries et vue tableau. */

export interface Series {
  key: string;
  label: string;
  color: string;
}

export interface StackedDatum {
  label: string;
  sublabel?: string;
  values: Record<string, number>;
}

/** Largeur réelle du conteneur : le SVG est dessiné au pixel près, le texte garde sa taille. */
function useWidth(fallback = 640) {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(fallback);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(220, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return { ref, w };
}

function niceMax(v: number): number {
  if (v <= 4) return 4;
  const mag = 10 ** Math.floor(Math.log10(v));
  const n = v / mag;
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
  return step * mag;
}

function compact(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)} k`;
  return String(Math.round(n));
}

export function Legend({ series }: { series: Series[] }) {
  if (series.length < 2) return null;
  return (
    <div className="legend chart-legend">
      {series.map((s) => (
        <span key={s.key}>
          <i style={{ background: s.color }} /> {s.label}
        </span>
      ))}
    </div>
  );
}

function ChartFrame({ title, children, table, empty }: { title: string; children: ReactNode; table: ReactNode; empty?: boolean }) {
  const [asTable, setAsTable] = useState(false);
  return (
    <div className="chart">
      <div className="chart-tools row">
        <button className="btn btn-ghost btn-sm" onClick={() => setAsTable((t) => !t)} aria-pressed={asTable} aria-label={asTable ? `Afficher le graphique : ${title}` : `Afficher le tableau : ${title}`}>
          {asTable ? <BarChart3 /> : <Table2 />}
          {asTable ? 'Graphique' : 'Tableau'}
        </button>
      </div>
      {empty ? <div className="chart-empty">Pas encore de données pour cette période.</div> : asTable ? <div className="table-wrap">{table}</div> : children}
    </div>
  );
}

/** Colonnes empilées (ex. réussites / erreurs par jour). */
export function StackedColumns({ data, series, title, height = 180, emptyHint }: { data: StackedDatum[]; series: Series[]; title: string; height?: number; emptyHint?: boolean }) {
  const [hover, setHover] = useState<number | null>(null);
  const { ref, w } = useWidth();
  const totals = data.map((d) => series.reduce((s, x) => s + (d.values[x.key] ?? 0), 0));
  const max = niceMax(Math.max(1, ...totals));
  const W = w;
  const H = height;
  const padL = 30;
  const padB = 24;
  const padT = 10;
  const innerW = W - padL - 6;
  const innerH = H - padB - padT;
  const band = innerW / Math.max(1, data.length);
  const barW = Math.min(24, band * 0.62);
  const ticks = [0, max / 2, max];
  const labelEvery = Math.ceil(data.length / Math.max(3, Math.floor(innerW / 44)));
  const empty = totals.every((t) => t === 0);
  return (
    <ChartFrame
      title={title}
      empty={empty && emptyHint}
      table={
        <table className="table">
          <thead>
            <tr>
              <th>Période</th>
              {series.map((s) => (
                <th key={s.key}>{s.label}</th>
              ))}
              <th>Total</th>
            </tr>
          </thead>
          <tbody>
            {data.map((d, i) => (
              <tr key={i}>
                <td>{d.sublabel ?? d.label}</td>
                {series.map((s) => (
                  <td key={s.key} className="tabular">
                    {d.values[s.key] ?? 0}
                  </td>
                ))}
                <td className="tabular">{totals[i]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      }
    >
      <Legend series={series} />
      <div className="chart-svg-wrap" ref={ref}>
        <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="chart-svg" role="img" aria-label={title} onMouseLeave={() => setHover(null)}>
          {ticks.map((t) => {
            const y = padT + innerH - (t / max) * innerH;
            return (
              <g key={t}>
                <line x1={padL} x2={W - 4} y1={y} y2={y} className="chart-grid" />
                <text x={padL - 6} y={y + 3.5} className="chart-tick" textAnchor="end">
                  {compact(t)}
                </text>
              </g>
            );
          })}
          {data.map((d, i) => {
            const cx = padL + band * i + band / 2;
            let acc = 0;
            const segs = series.map((s) => {
              const v = d.values[s.key] ?? 0;
              const h = (v / max) * innerH;
              const y = padT + innerH - acc - h;
              acc += h;
              return { s, v, h, y };
            });
            const visible = segs.filter((g) => g.h > 0);
            return (
              <g key={i} onMouseEnter={() => setHover(i)} onFocus={() => setHover(i)} tabIndex={-1}>
                <rect x={padL + band * i} y={padT} width={band} height={innerH} fill="transparent" />
                {visible.map((g, j) => {
                  const top = j === visible.length - 1;
                  const gap = j > 0 ? 2 : 0;
                  const h = Math.max(0, g.h - gap);
                  const r = top ? Math.min(4, h / 2, barW / 2) : 0;
                  return <path key={g.s.key} d={roundedTop(cx - barW / 2, g.y, barW, h, r)} fill={g.s.color} opacity={hover == null || hover === i ? 1 : 0.55} />;
                })}
                {i % labelEvery === 0 && (
                  <text x={cx} y={H - 7} className="chart-tick" textAnchor="middle">
                    {d.label}
                  </text>
                )}
              </g>
            );
          })}
          <line x1={padL} x2={W - 4} y1={padT + innerH} y2={padT + innerH} className="chart-axis" />
        </svg>
        {hover != null && (
          <div className="chart-tooltip" style={{ left: `${((padL + band * hover + band / 2) / W) * 100}%` }}>
            <strong>{data[hover].sublabel ?? data[hover].label}</strong>
            {series.map((s) => (
              <span key={s.key}>
                <i style={{ background: s.color }} />
                {s.label} : <b>{data[hover].values[s.key] ?? 0}</b>
              </span>
            ))}
          </div>
        )}
      </div>
    </ChartFrame>
  );
}

function roundedTop(x: number, y: number, w: number, h: number, r: number): string {
  if (h <= 0) return '';
  if (r <= 0) return `M${x},${y}h${w}v${h}h${-w}z`;
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}

export interface BarRow {
  label: string;
  value: number | null;
  /** Texte de la valeur affiché au bout de la barre. */
  display: string;
  detail?: string;
}

/** Barres horizontales (une seule série) : taux par catégorie. */
export function HBars({ rows, title, max = 1, color = 'var(--chart-1)' }: { rows: BarRow[]; title: string; max?: number; color?: string }) {
  return (
    <ChartFrame
      title={title}
      empty={!rows.length}
      table={
        <table className="table">
          <thead>
            <tr>
              <th>Catégorie</th>
              <th>Valeur</th>
              <th>Détail</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.label}>
                <td>{r.label}</td>
                <td className="tabular">{r.display}</td>
                <td className="muted">{r.detail}</td>
              </tr>
            ))}
          </tbody>
        </table>
      }
    >
      <div className="hbars" role="list" aria-label={title}>
        {rows.map((r) => (
          <div className="hbar" role="listitem" key={r.label} title={r.detail}>
            <span className="hbar-label truncate">{r.label}</span>
            <span className="hbar-track">
              <span style={{ width: `${Math.max(0, Math.min(1, (r.value ?? 0) / max)) * 100}%`, background: color }} />
            </span>
            <span className="hbar-value tabular">{r.display}</span>
          </div>
        ))}
      </div>
    </ChartFrame>
  );
}

/** Calendrier thermique : une teinte, du clair au foncé. */
export function CalendarHeat({ days, title, valueLabel }: { days: Array<{ day: string; ts: number; value: number }>; title: string; valueLabel: string }) {
  const max = Math.max(1, ...days.map((d) => d.value));
  const first = new Date(days[0]?.ts ?? Date.now());
  const offset = (first.getDay() + 6) % 7;
  const cells = [...Array(offset).fill(null), ...days];
  const weeks = Math.ceil(cells.length / 7);
  const [hover, setHover] = useState<number | null>(null);
  const level = (v: number) => (v === 0 ? 0 : Math.min(4, Math.ceil((v / max) * 4)));
  return (
    <ChartFrame
      title={title}
      table={
        <table className="table">
          <thead>
            <tr>
              <th>Jour</th>
              <th>{valueLabel}</th>
            </tr>
          </thead>
          <tbody>
            {days
              .filter((d) => d.value > 0)
              .map((d) => (
                <tr key={d.day}>
                  <td>{new Date(d.ts).toLocaleDateString('fr-FR')}</td>
                  <td className="tabular">{d.value}</td>
                </tr>
              ))}
          </tbody>
        </table>
      }
    >
      <div className="cal-wrap">
        <div className="cal" style={{ gridTemplateColumns: `repeat(${weeks}, 1fr)` }} role="img" aria-label={title}>
          {cells.map((c, i) =>
            c ? (
              <span
                key={i}
                className={`cal-cell lv${level(c.value)}`}
                style={{ gridRow: (i % 7) + 1, gridColumn: Math.floor(i / 7) + 1 }}
                onMouseEnter={() => setHover(i)}
                onMouseLeave={() => setHover(null)}
                title={`${new Date(c.ts).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })} : ${c.value} ${valueLabel.toLowerCase()}`}
              />
            ) : (
              <span key={i} style={{ gridRow: (i % 7) + 1, gridColumn: Math.floor(i / 7) + 1 }} />
            ),
          )}
        </div>
        <div className="cal-scale">
          <span>0</span>
          {[1, 2, 3, 4].map((l) => (
            <i key={l} className={`cal-cell lv${l}`} />
          ))}
          <span>{max}</span>
        </div>
        {hover != null && cells[hover] && (
          <div className="cal-hover small">
            {new Date(cells[hover].ts).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })} — <b>{cells[hover].value}</b> {valueLabel.toLowerCase()}
          </div>
        )}
      </div>
    </ChartFrame>
  );
}

/** Barre empilée horizontale unique (répartition de la maîtrise). */
export function SplitBar({ parts, title }: { parts: Array<{ key: string; label: string; value: number; className: string }>; title: string }) {
  const total = parts.reduce((s, p) => s + p.value, 0);
  return (
    <div className="stack-sm">
      <div className="mastery-bar" style={{ height: 14 }} role="img" aria-label={`${title} : ${parts.map((p) => `${p.label} ${p.value}`).join(', ')}`}>
        {parts.map((p) => (p.value ? <span key={p.key} className={p.className} style={{ width: `${(p.value / Math.max(1, total)) * 100}%` }} title={`${p.label} : ${p.value}`} /> : null))}
      </div>
      <div className="legend">
        {parts.map((p) => (
          <span key={p.key}>
            <i className={p.className} /> {p.label} <b className="tabular">{p.value}</b>
          </span>
        ))}
      </div>
    </div>
  );
}
