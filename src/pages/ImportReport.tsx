import { AlertTriangle, CheckCircle2, XCircle } from 'lucide-react';
import type { PgnIssue } from '../core/pgn/types';

export interface ReportStats {
  games: number;
  validGames?: number;
  positions: number;
  lines: number;
  variations: number;
  comments: number;
  shapes?: number;
  invalidMoves: number;
  moves: number;
}

export function ReportStatsGrid({ s }: { s: ReportStats }) {
  const items: Array<[string, number | string]> = [
    ['Parties / chapitres', s.games],
    ['Coups', s.moves],
    ['Positions', s.positions],
    ['Lignes', s.lines],
    ['Variantes (RAV)', s.variations],
    ['Commentaires', s.comments],
  ];
  if (s.shapes != null) items.push(['Flèches & cases', s.shapes]);
  items.push(['Coups invalides', s.invalidMoves]);
  return (
    <dl className="report-grid">
      {items.map(([k, v]) => (
        <div key={k}>
          <dt>{k}</dt>
          <dd className={k === 'Coups invalides' && Number(v) > 0 ? 'text-danger' : ''}>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

export function IssuesList({ issues, max = 50 }: { issues: PgnIssue[]; max?: number }) {
  const errors = issues.filter((i) => i.severity === 'error');
  const warnings = issues.filter((i) => i.severity === 'warning');
  if (!issues.length)
    return (
      <div className="notice notice-success">
        <CheckCircle2 />
        <div>Aucune erreur : tous les coups ont été validés comme légaux à partir de la position de départ déclarée.</div>
      </div>
    );
  return (
    <div className="stack-sm">
      <div className="row row-wrap small">
        {errors.length > 0 && (
          <span className="badge badge-danger">
            <XCircle /> {errors.length} erreur{errors.length > 1 ? 's' : ''}
          </span>
        )}
        {warnings.length > 0 && (
          <span className="badge badge-warning">
            <AlertTriangle /> {warnings.length} avertissement{warnings.length > 1 ? 's' : ''}
          </span>
        )}
      </div>
      <ul className="issues">
        {[...errors, ...warnings].slice(0, max).map((i, k) => (
          <li key={k} className={`issue issue-${i.severity}`}>
            {i.severity === 'error' ? <XCircle /> : <AlertTriangle />}
            <div>
              <div className="issue-where">
                {i.gameIndex >= 0 ? `Partie ${i.gameIndex + 1} « ${i.gameLabel} »` : 'Fichier'}
                {i.moveLabel && <span> · coup {i.moveLabel}</span>}
                {i.line && (
                  <span>
                    {' '}
                    · ligne {i.line}
                    {i.column ? `, colonne ${i.column}` : ''}
                  </span>
                )}
              </div>
              <div className="issue-msg">{i.message}</div>
            </div>
          </li>
        ))}
      </ul>
      {issues.length > max && <p className="small faint">… et {issues.length - max} autres.</p>}
      {errors.length > 0 && (
        <p className="small muted">
          Rien n’est supprimé : les parties ou variantes illisibles sont conservées telles quelles (texte d’origine) et exclues des révisions. Tu peux les corriger dans
          l’éditeur.
        </p>
      )}
    </div>
  );
}
