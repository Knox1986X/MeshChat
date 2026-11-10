import type { CapacitorConfig } from '@capacitor/cli';

/**
 * Android/iOS shell for MeshChat.
 *
 * The web app is the same bundle the relay serves; Capacitor wraps it into an
 * APK. Run `npm run build && npx cap add android && npx cap sync android`.
 *
 * Note: a WebView app cannot host the relay itself (no Node), so point the app
 * at a relay you trust: it is stored per device in IndexedDB.
 */
const config: CapacitorConfig = {
  appId: 'chat.mesh.app',
  appName: 'MeshChat',
  webDir: 'packages/relay/public',
  android: {
    allowMixedContent: true,
    backgroundColor: '#06090b',
  },
  server: {
    androidScheme: 'https',
  },
  plugins: {
    SplashScreen: {
      backgroundColor: '#06090b',
      showSpinner: false,
    },
  },
};

export default config;
