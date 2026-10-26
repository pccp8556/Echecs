import { StrictMode, lazy, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, createMemoryRouter, RouterProvider } from 'react-router';
import { IS_ARTIFACT_PREVIEW } from './config';
import '@fontsource-variable/fraunces/opsz.css';
import '@fontsource-variable/fraunces/opsz-italic.css';
import '@fontsource-variable/manrope';
import '@fontsource-variable/jetbrains-mono';
import './styles/tokens.css';
import './styles/base.css';
import './styles/components.css';
import './styles/layout.css';
import './styles/board.css';
import './styles/pages.css';
import App from './App';
import { applySettings, useSettings } from './state/settings';
import { Loading } from './ui/kit';
import Dashboard from './pages/Dashboard';
import NotFound from './pages/NotFound';
import RouteError from './pages/RouteError';

const Library = lazy(() => import('./pages/Library'));
const ImportPage = lazy(() => import('./pages/Import'));
const RepertoirePage = lazy(() => import('./pages/Repertoire'));
const EditorPage = lazy(() => import('./pages/Editor'));
const SessionSetup = lazy(() => import('./pages/SessionSetup'));
const ReviewPage = lazy(() => import('./pages/Review'));
const StatsPage = lazy(() => import('./pages/Stats'));
const SettingsPage = lazy(() => import('./pages/Settings'));

applySettings(useSettings.getState().settings);

const wrap = (el: React.ReactNode) => <Suspense fallback={<Loading />}>{el}</Suspense>;

const routes = [
  {
    path: '/',
    element: <App />,
    errorElement: <RouteError />,
    children: [
      { index: true, element: <Dashboard /> },
      { path: 'bibliotheque', element: wrap(<Library />) },
      { path: 'importer', element: wrap(<ImportPage />) },
      { path: 'repertoire/:id', element: wrap(<RepertoirePage />) },
      { path: 'repertoire/:id/editer', element: wrap(<EditorPage />) },
      { path: 'session/nouvelle', element: wrap(<SessionSetup />) },
      { path: 'session/:id', element: wrap(<ReviewPage />) },
      { path: 'statistiques', element: wrap(<StatsPage />) },
      { path: 'parametres', element: wrap(<SettingsPage />) },
      { path: '*', element: <NotFound /> },
    ],
  },
];

// Dans la préversion claude.ai, l'adresse de la page ne peut pas porter les routes : routeur en mémoire.
const router = IS_ARTIFACT_PREVIEW ? createMemoryRouter(routes) : createBrowserRouter(routes);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
