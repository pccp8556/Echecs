import { useEffect } from 'react';
import { NavLink, Outlet, useLocation, Link } from 'react-router';
import { BarChart3, BookOpen, GraduationCap, Home, Settings as SettingsIcon, Upload } from 'lucide-react';
import { PieceSprites, PieceSvg } from './ui/board/pieces';
import { DialogHost, Toasts } from './ui/kit';
import { useLibrary } from './state/library';
import { APP_NAME, APP_TAGLINE } from './config';
import { UpdatePrompt } from './ui/UpdatePrompt';

const NAV = [
  { to: '/', label: 'Accueil', icon: Home, end: true },
  { to: '/bibliotheque', label: 'Bibliothèque', icon: BookOpen },
  { to: '/session/nouvelle', label: 'Réviser', icon: GraduationCap },
  { to: '/statistiques', label: 'Statistiques', icon: BarChart3 },
  { to: '/parametres', label: 'Réglages', icon: SettingsIcon },
];

export function BrandMark() {
  return (
    <span className="brand-mark" aria-hidden="true">
      <PieceSvg set="cburnett" piece="wn" />
    </span>
  );
}

export default function App() {
  const load = useLibrary((s) => s.load);
  const location = useLocation();
  const focus = /^\/session\/(?!nouvelle)/.test(location.pathname);
  useEffect(() => {
    load();
  }, [load]);
  useEffect(() => {
    document.getElementById('main')?.focus({ preventScroll: true });
    if (!focus) window.scrollTo({ top: 0 });
  }, [location.pathname, focus]);

  return (
    <div className={`app ${focus ? 'is-focus' : ''}`}>
      <PieceSprites />
      <a className="skip-link" href="#main">
        Aller au contenu
      </a>
      <aside className="sidebar" aria-label="Navigation principale">
        <Link to="/" className="brand">
          <BrandMark />
          <span className="brand-name">
            {APP_NAME}
            <small>{APP_TAGLINE}</small>
          </span>
        </Link>
        <nav className="nav">
          {NAV.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end}>
              <n.icon aria-hidden="true" />
              {n.label}
            </NavLink>
          ))}
        </nav>
        <div className="nav-section">Répertoires</div>
        <nav className="nav">
          <NavLink to="/importer">
            <Upload aria-hidden="true" />
            Importer un PGN
          </NavLink>
        </nav>
        <div className="sidebar-footer">
          <div className="storage-note">
            <strong>Données locales.</strong> Tes répertoires et ta progression restent dans ce navigateur. Pense à exporter une sauvegarde pour
            les retrouver sur un autre appareil.
          </div>
        </div>
      </aside>
      <header className="mobile-top">
        <Link to="/" className="brand">
          <BrandMark />
          <span className="brand-name">{APP_NAME}</span>
        </Link>
        <Link to="/importer" className="btn btn-sm" aria-label="Importer un PGN">
          <Upload /> Importer
        </Link>
      </header>
      <main className="main" id="main" tabIndex={-1} style={{ outline: 'none' }}>
        <Outlet />
      </main>
      <nav className="tabbar" aria-label="Navigation">
        {NAV.map((n) => (
          <NavLink key={n.to} to={n.to} end={n.end}>
            <n.icon aria-hidden="true" />
            {n.label}
          </NavLink>
        ))}
      </nav>
      <Toasts />
      <DialogHost />
      <UpdatePrompt />
    </div>
  );
}
