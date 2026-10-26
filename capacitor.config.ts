import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'io.github.pccp8556.paulauraittrouve',
  appName: 'Paul aurait trouvé',
  webDir: 'dist',
  android: {
    // L'application est servie localement (https://localhost) : aucun contenu distant n'est chargé dans la WebView.
    allowMixedContent: false,
    backgroundColor: '#0a0f14',
  },
};

export default config;
