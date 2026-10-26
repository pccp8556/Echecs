/**
 * Intégration Android (Capacitor). Dans le navigateur, ces fonctions se
 * rabattent sur le comportement web standard.
 */
interface CapacitorGlobal {
  isNativePlatform?: () => boolean;
  getPlatform?: () => string;
}

export function isNative(): boolean {
  const cap = (globalThis as { Capacitor?: CapacitorGlobal }).Capacitor;
  return !!cap?.isNativePlatform?.();
}

/**
 * Enregistre un fichier dans le cache de l'application puis ouvre la feuille de
 * partage Android (Enregistrer dans Fichiers, Drive, e-mail…). Le téléchargement
 * par lien n'existe pas dans la WebView Android.
 */
export async function shareTextFile(name: string, text: string, mime: string): Promise<void> {
  const [{ Filesystem, Directory, Encoding }, { Share }] = await Promise.all([import('@capacitor/filesystem'), import('@capacitor/share')]);
  const res = await Filesystem.writeFile({ path: name, data: text, directory: Directory.Cache, encoding: Encoding.UTF8 });
  await Share.share({ title: name, files: [res.uri], dialogTitle: 'Enregistrer ou partager' });
  void mime;
}
