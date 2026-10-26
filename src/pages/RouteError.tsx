import { Link, isRouteErrorResponse, useRouteError } from 'react-router';
import { AlertTriangle } from 'lucide-react';

/** Écran d'erreur inattendue : rien n'est perdu, les données restent dans le navigateur. */
export default function RouteError() {
  const err = useRouteError();
  const msg = isRouteErrorResponse(err) ? `${err.status} ${err.statusText}` : err instanceof Error ? err.message : String(err);
  const isChunk = /Failed to fetch dynamically imported module|Importing a module script failed/i.test(msg);
  return (
    <div className="page page-narrow" style={{ paddingTop: 60 }}>
      <div className="card stack">
        <h1 className="row">
          <AlertTriangle /> Oups, une erreur
        </h1>
        <p className="muted">
          {isChunk
            ? 'Une nouvelle version de l’application a été publiée ou la connexion a été perdue. Recharge la page.'
            : 'Une erreur inattendue est survenue. Tes répertoires et ta progression sont intacts (ils sont enregistrés localement).'}
        </p>
        <pre className="mono small" style={{ whiteSpace: 'pre-wrap', color: 'var(--text-faint)' }}>{msg}</pre>
        <div className="row">
          <button className="btn btn-primary" onClick={() => location.reload()}>
            Recharger
          </button>
          <Link className="btn" to="/" reloadDocument>
            Accueil
          </Link>
        </div>
      </div>
    </div>
  );
}
