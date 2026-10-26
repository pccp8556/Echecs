import { useEffect, useState } from 'react';
import { RefreshCw, WifiOff } from 'lucide-react';
import { isNative } from '../native';

/**
 * Service worker (PWA) : met l'application en cache pour un usage hors ligne et
 * propose de recharger quand une nouvelle version est disponible.
 */
export function UpdatePrompt() {
  const [needRefresh, setNeedRefresh] = useState(false);
  const [offlineReady, setOfflineReady] = useState(false);
  const [update, setUpdate] = useState<(() => Promise<void>) | null>(null);
  const [online, setOnline] = useState(typeof navigator === 'undefined' ? true : navigator.onLine);

  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);

  useEffect(() => {
    // Dans l'application Android, les fichiers sont déjà embarqués : pas de service worker.
    if (import.meta.env.DEV || !('serviceWorker' in navigator) || isNative()) return;
    let cancelled = false;
    import('virtual:pwa-register')
      .then(({ registerSW }) => {
        if (cancelled) return;
        const updateSW = registerSW({
          onNeedRefresh: () => setNeedRefresh(true),
          onOfflineReady: () => {
            setOfflineReady(true);
            window.setTimeout(() => setOfflineReady(false), 5000);
          },
        });
        setUpdate(() => () => updateSW(true));
      })
      .catch(() => {
        /* PWA indisponible (ex. contexte non sécurisé) */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!online)
    return (
      <div className="toasts" style={{ left: 18, right: 'auto' }}>
        <div className="toast toast-info">
          <WifiOff />
          <div className="toast-body">
            <div className="toast-title">Hors ligne</div>
            <div className="toast-msg">La révision et tes données locales restent disponibles. L’import depuis GitHub nécessite Internet.</div>
          </div>
        </div>
      </div>
    );
  if (!needRefresh && !offlineReady) return null;
  return (
    <div className="toasts" style={{ left: 18, right: 'auto' }}>
      <div className="toast toast-success">
        <RefreshCw />
        <div className="toast-body">
          <div className="toast-title">{needRefresh ? 'Nouvelle version disponible' : 'Prête pour le hors-ligne'}</div>
          <div className="toast-msg">{needRefresh ? 'Recharge pour profiter des dernières améliorations.' : 'L’application fonctionne désormais sans connexion.'}</div>
        </div>
        {needRefresh && update && (
          <button className="btn btn-sm btn-primary" onClick={() => update()}>
            Recharger
          </button>
        )}
      </div>
    </div>
  );
}
