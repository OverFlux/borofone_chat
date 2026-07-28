import { app } from './runtime.js';
import { legacyMainScripts } from './manifest.js?v=3';
import { loadScriptsSequentially } from './loaders/sequential.js';

async function bootstrap() {
    await loadScriptsSequentially(legacyMainScripts);
    app.meta.loadedAt = Date.now();
    app.meta.loadedScripts = legacyMainScripts.slice();
}

bootstrap().catch((error) => {
    console.error('[BorofoneApp] Bootstrap failed:', error);
    throw error;
});
