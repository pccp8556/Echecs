import { useEffect, useRef, useState } from 'react';
import { Database, Download, FolderGit2, HardDrive, Info, KeyRound, Monitor, Moon, Palette, RotateCcw, Sun, Upload, Cpu, GraduationCap, Trash2, LayoutGrid } from 'lucide-react';
import { useSettings, type Settings } from '../state/settings';
import { useLibrary } from '../state/library';
import { BOARD_THEMES } from '../ui/board/themes';
import { PIECE_SETS, type PieceSetId } from '../ui/board/pieces';
import { Board } from '../ui/board/Board';
import { exportBackup, importBackup, validateBackup, BackupError } from '../storage/backup';
import { storageEstimate, getDb, resetDbConnection, DB_NAME } from '../storage/db';
import { getToken, setToken, whoAmI } from '../integrations/github';
import { Segmented, Switch, confirmDialog, downloadText, toast } from '../ui/kit';
import { PageHeader } from './common';
import { APP_NAME, APP_VERSION } from '../config';
import { formatSan } from '../core/chess/notation';
import { GithubError } from '../integrations/github';

function Section({ id, icon, title, children, desc }: { id: string; icon: React.ReactNode; title: string; children: React.ReactNode; desc?: string }) {
  return (
    <section className="card stack settings-section" id={id} aria-labelledby={`h-${id}`}>
      <div>
        <h2 id={`h-${id}`} className="row">
          {icon} {title}
        </h2>
        {desc && <p className="small muted" style={{ marginTop: 4 }}>{desc}</p>}
      </div>
      {children}
    </section>
  );
}

export default function SettingsPage() {
  const { settings: s, set, reset, replace } = useSettings();
  const lib = useLibrary();
  const [estimate, setEstimate] = useState<{ usage: number; quota: number } | null>(null);
  const [tokenInput, setTokenInput] = useState('');
  const [tokenStatus, setTokenStatus] = useState<string>('');
  const [hasToken, setHasToken] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    storageEstimate().then(setEstimate);
    getToken().then((t) => setHasToken(!!t));
  }, []);
  useEffect(() => {
    if (location.hash) document.querySelector(location.hash)?.scrollIntoView();
  }, []);

  const upd = <K extends keyof Settings>(k: K) => (v: Settings[K]) => set({ [k]: v } as Partial<Settings>);

  const doBackup = async () => {
    const b = await exportBackup({ includeRevisions: true, settings: s as unknown as Record<string, unknown> });
    downloadText(`sauvegarde-${APP_NAME.toLowerCase().replace(/\s+/g, '-')}-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(b), 'application/json');
    toast.success('Sauvegarde exportée', `${b.data.repertoires.length} répertoires, ${b.data.cards.length} positions suivies, ${b.data.logs.length} réponses.`);
  };

  const doRestore = async (file: File) => {
    let parsed;
    try {
      parsed = validateBackup(JSON.parse(await file.text()));
    } catch (e) {
      toast.error('Sauvegarde invalide', e instanceof BackupError ? e.message : 'Le fichier n’est pas un JSON valide.');
      return;
    }
    const d = parsed.data;
    const summary = `${d.repertoires.length} répertoires, ${d.games.length} parties, ${d.cards.length} positions suivies, ${d.logs.length} réponses (sauvegarde du ${new Date(parsed.exportedAt).toLocaleString('fr-FR')}).`;
    const replaceAll = await confirmDialog({
      title: 'Restaurer la sauvegarde',
      message: (
        <div className="stack-sm">
          <p>{summary}</p>
          <p>
            <strong>Confirmer</strong> remplace toutes les données actuelles. Pour plutôt <strong>fusionner</strong> (ajouter sans rien effacer), annule puis choisis « Fusionner ».
          </p>
        </div>
      ),
      confirmLabel: 'Remplacer mes données',
      danger: true,
    });
    if (replaceAll) {
      const r = await importBackup(parsed, 'replace');
      if (d.settings) replace(d.settings as Partial<Settings>);
      await lib.refresh();
      toast.success('Sauvegarde restaurée', `${r.repertoires} répertoires restaurés.`);
      return;
    }
    const merge = await confirmDialog({ title: 'Fusionner la sauvegarde ?', message: `${summary} Les éléments existants avec le même identifiant seront remplacés, les autres conservés.`, confirmLabel: 'Fusionner' });
    if (merge) {
      const r = await importBackup(parsed, 'merge');
      await lib.refresh();
      toast.success('Sauvegarde fusionnée', `${r.repertoires} répertoires importés.`);
    }
  };

  const wipe = async () => {
    const ok = await confirmDialog({ title: 'Effacer toutes les données', danger: true, message: 'Tous les répertoires, la progression, les sessions et l’historique de ce navigateur seront supprimés définitivement. Exporte une sauvegarde avant.', confirmLabel: 'Tout effacer', typeToConfirm: 'EFFACER' });
    if (!ok) return;
    await resetDbConnection();
    await new Promise<void>((resolve) => {
      const req = indexedDB.deleteDatabase(DB_NAME);
      req.onsuccess = req.onerror = req.onblocked = () => resolve();
    });
    try {
      localStorage.clear();
    } catch {
      /* ignore */
    }
    await getDb();
    await lib.refresh();
    toast.success('Données effacées');
  };

  const saveToken = async () => {
    const t = tokenInput.trim();
    if (!t) return;
    setTokenStatus('Vérification…');
    try {
      const login = await whoAmI(t);
      await setToken(t, s.githubRememberToken);
      setHasToken(true);
      setTokenInput('');
      setTokenStatus(`Jeton valide (compte ${login}). ${s.githubRememberToken ? 'Mémorisé sur cet appareil.' : 'Gardé pour cette session uniquement.'}`);
    } catch (e) {
      setTokenStatus(e instanceof GithubError ? e.message : 'Vérification impossible.');
    }
  };

  return (
    <div className="page page-narrow">
      <PageHeader eyebrow="Réglages" title="Préférences" actions={<button className="btn btn-ghost" onClick={async () => (await confirmDialog({ title: 'Réinitialiser les préférences', message: 'Les préférences reprennent leurs valeurs par défaut. Tes répertoires et ta progression ne sont pas touchés.', confirmLabel: 'Réinitialiser' })) && reset()}><RotateCcw /> Valeurs par défaut</button>} />

      <nav className="settings-nav" aria-label="Sections">
        {[
          ['apparence', 'Apparence'],
          ['echiquier', 'Échiquier'],
          ['revision', 'Révision'],
          ['analyse', 'Analyse'],
          ['donnees', 'Données'],
          ['github', 'GitHub'],
          ['apropos', 'À propos'],
        ].map(([id, label]) => (
          <a key={id} href={`#${id}`} className="chip">
            {label}
          </a>
        ))}
      </nav>

      <Section id="apparence" icon={<Palette />} title="Apparence">
        <div className="field">
          <span className="field-label">Thème</span>
          <Segmented label="Thème" value={s.theme} onChange={upd('theme')} options={[{ value: 'dark', label: 'Sombre', icon: <Moon /> }, { value: 'light', label: 'Clair', icon: <Sun /> }, { value: 'system', label: 'Système', icon: <Monitor /> }]} />
        </div>
        <div className="field">
          <label htmlFor="font">Taille du texte : {Math.round(s.fontScale * 100)} %</label>
          <input id="font" type="range" className="range" min={0.85} max={1.3} step={0.05} value={s.fontScale} onChange={(e) => set({ fontScale: Number(e.target.value) })} />
        </div>
        <div className="field">
          <span className="field-label">Animations</span>
          <Segmented label="Animations" value={s.motion} onChange={upd('motion')} options={[{ value: 'system', label: 'Selon le système' }, { value: 'on', label: 'Activées' }, { value: 'off', label: 'Désactivées' }]} />
        </div>
        <div className="field">
          <span className="field-label">Notation</span>
          <Segmented
            label="Notation"
            value={s.notation}
            onChange={upd('notation')}
            options={[
              { value: 'fr', label: `Française (${formatSan('Nf3', 'fr')})` },
              { value: 'en', label: 'Anglaise (Nf3)' },
              { value: 'figurine', label: `Figurines (${formatSan('Nf3', 'figurine')})` },
            ]}
          />
        </div>
      </Section>

      <Section id="echiquier" icon={<LayoutGrid />} title="Échiquier">
        <div className="settings-board-preview">
          <div style={{ width: 220 }}>
            <Board fen="r1bqkb1r/pppp1ppp/2n2n2/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4" orientation="w" theme={s.boardTheme} pieceSet={s.pieceSet} coordinates={s.coordinates} lastMove={{ from: 'g8', to: 'f6' }} drawable={false} label="Aperçu de l’échiquier" />
          </div>
          <div className="stack grow">
            <div className="field">
              <span className="field-label">Cases</span>
              <div className="theme-grid" role="radiogroup" aria-label="Thème des cases">
                {BOARD_THEMES.map((t) => (
                  <button key={t.id} role="radio" aria-checked={s.boardTheme === t.id} className={`theme-swatch ${s.boardTheme === t.id ? 'is-active' : ''}`} onClick={() => set({ boardTheme: t.id })} title={t.label}>
                    <span style={{ background: `linear-gradient(135deg, ${t.light} 50%, ${t.dark} 50%)` }} />
                    {t.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="field">
              <span className="field-label">Pièces</span>
              <Segmented label="Jeu de pièces" value={s.pieceSet} onChange={(v) => set({ pieceSet: v as PieceSetId })} options={(Object.keys(PIECE_SETS) as PieceSetId[]).map((p) => ({ value: p, label: PIECE_SETS[p].label }))} />
            </div>
          </div>
        </div>
        <Switch checked={s.coordinates} onChange={upd('coordinates')} label="Coordonnées" />
      </Section>

      <Section id="revision" icon={<GraduationCap />} title="Révision">
        <div className="field">
          <span className="field-label">Ton du message « Paul aurait trouvé »</span>
          <Segmented label="Style" value={s.feedbackStyle} onChange={upd('feedbackStyle')} options={[{ value: 'sober', label: 'Sobre' }, { value: 'encouraging', label: 'Encourageant' }, { value: 'humorous', label: 'Humoristique' }, { value: 'competitive', label: 'Compétitif' }]} />
        </div>
        <div className="field">
          <span className="field-label">Après une erreur</span>
          <Segmented
            label="Après une erreur"
            value={s.secondChance ? 'retry' : 'show'}
            onChange={(v) => set({ secondChance: v === 'retry' })}
            options={[
              { value: 'show', label: 'Montrer la solution' },
              { value: 'retry', label: 'Un second essai d’abord' },
            ]}
          />
        </div>
        <div className="field">
          <label htmlFor="newl">Nouvelles positions par révision du jour</label>
          <input id="newl" className="input" type="number" min={0} max={200} value={s.newLimit} onChange={(e) => set({ newLimit: Math.max(0, Number(e.target.value) || 0) })} style={{ maxWidth: 140 }} />
        </div>
        <Switch checked={s.askConfidence} onChange={upd('askConfidence')} label="Noter moi-même chaque bonne réponse" hint="À revoir, Difficile, Bien ou Facile. Sinon la note est automatique (temps, indices)." />
      </Section>

      <Section id="analyse" icon={<Cpu />} title="Analyse (Stockfish)" desc="Moteur chargé à la demande (≈ 7 Mo). Il informe sans jamais modifier tes lignes ni la correction.">
        <Switch checked={s.engineEnabled} onChange={upd('engineEnabled')} label="Proposer l’analyse dans l’explorateur" />
      </Section>

      <Section id="donnees" icon={<Database />} title="Données et sauvegardes">
        <div className="notice">
          <Info />
          <div>
            Tes données sont enregistrées <strong>uniquement dans ce navigateur</strong> (IndexedDB). Elles ne sont pas synchronisées entre appareils : exporte une sauvegarde
            et restaure-la sur l’autre appareil. Vider les données du site ou désinstaller l’application les efface.
          </div>
        </div>
        <div className="row row-wrap small muted">
          <HardDrive size={16} />
          {estimate ? `Espace utilisé : ${(estimate.usage / 1048576).toFixed(1)} Mo sur ${(estimate.quota / 1073741824).toFixed(1)} Go disponibles` : 'Espace utilisé : inconnu'}
        </div>
        <div className="row row-wrap">
          <button className="btn btn-primary" onClick={doBackup}>
            <Download /> Exporter une sauvegarde complète
          </button>
          <button className="btn" onClick={() => fileRef.current?.click()}>
            <Upload /> Restaurer une sauvegarde
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) doRestore(f);
              e.target.value = '';
            }}
          />
        </div>
        <p className="small faint">La sauvegarde contient répertoires, parties, progression, journal des réponses, sessions, sélections enregistrées, historique des versions et préférences. Elle n’inclut jamais ton jeton GitHub.</p>
        <hr className="divider" />
        <button className="btn btn-danger" onClick={wipe} style={{ alignSelf: 'flex-start' }}>
          <Trash2 /> Effacer toutes les données
        </button>
      </Section>

      <Section id="github" icon={<FolderGit2 />} title="GitHub" desc="Pour importer des PGN depuis un dépôt. Les dépôts publics ne demandent rien.">
        <div className="notice">
          <KeyRound />
          <div className="stack-sm">
            <div>
              <strong>Dépôt privé :</strong> crée un jeton « fine-grained » sur GitHub (Settings → Developer settings → Personal access tokens → Fine-grained), limité au seul
              dépôt concerné, avec la permission <code>Contents: Read-only</code> et une date d’expiration. Aucune autre permission n’est nécessaire.
            </div>
            <div>
              Le jeton reste sur cet appareil : il n’est envoyé qu’à <code>api.github.com</code>, n’est jamais inclus dans le code, les exports ou les sauvegardes. Par défaut il
              est oublié à la fermeture de l’onglet.
            </div>
          </div>
        </div>
        <div className="field">
          <label htmlFor="tok">Jeton d’accès (lecture seule)</label>
          <div className="row">
            <input id="tok" className="input mono" type="password" autoComplete="off" value={tokenInput} onChange={(e) => setTokenInput(e.target.value)} placeholder={hasToken ? '•••••••• (jeton configuré)' : 'github_pat_…'} />
            <button className="btn btn-primary" onClick={saveToken} disabled={!tokenInput.trim()}>
              Vérifier et utiliser
            </button>
          </div>
          {tokenStatus && <span className="field-hint">{tokenStatus}</span>}
        </div>
        <Switch checked={s.githubRememberToken} onChange={upd('githubRememberToken')} label="Mémoriser le jeton sur cet appareil" hint="Déconseillé sur un appareil partagé." />
        {hasToken && (
          <button
            className="btn btn-danger"
            style={{ alignSelf: 'flex-start' }}
            onClick={async () => {
              await setToken(null, false);
              setHasToken(false);
              setTokenStatus('Jeton supprimé.');
            }}
          >
            Oublier le jeton
          </button>
        )}
        <p className="small faint">L’envoi de modifications vers GitHub n’est pas proposé : exporte ton PGN modifié puis pousse-le avec ton outil habituel.</p>
      </Section>

      <Section id="apropos" icon={<Info />} title="À propos">
        <p className="small">
          {APP_NAME} · version {APP_VERSION}. Application locale : aucune donnée n’est envoyée à un serveur de l’application.
        </p>
        <ul className="small muted credits">
          <li>Règles et validation des coups : chess.js (BSD-2-Clause).</li>
          <li>Analyse PGN : @mliebelt/pgn-parser (Apache-2.0).</li>
          <li>Répétition espacée : ts-fsrs, algorithme FSRS (MIT).</li>
          <li>Moteur : Stockfish 18 / Stockfish.js (GPL-3.0), fichiers et licence dans /stockfish/.</li>
          {(Object.keys(PIECE_SETS) as PieceSetId[]).map((p) => (
            <li key={p}>
              Pièces « {PIECE_SETS[p].label} » : {PIECE_SETS[p].credit} — {PIECE_SETS[p].license}.
            </li>
          ))}
          <li>Polices : Fraunces, Manrope, JetBrains Mono (SIL Open Font License).</li>
          <li>Icônes : Lucide (ISC).</li>
        </ul>
      </Section>
    </div>
  );
}
