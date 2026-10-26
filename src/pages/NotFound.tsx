import { Link } from 'react-router';
import { Compass } from 'lucide-react';
import { EmptyState } from '../ui/kit';

export default function NotFound() {
  return (
    <div className="page page-narrow">
      <div className="card">
        <EmptyState icon={<Compass />} title="Page introuvable" action={<Link to="/" className="btn btn-primary">Retour à l’accueil</Link>}>
          Cette adresse ne correspond à aucune page. Même Paul ne l’aurait pas trouvée.
        </EmptyState>
      </div>
    </div>
  );
}
