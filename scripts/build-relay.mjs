#!/usr/bin/env node
/**
 * Bundles the relay (plus the shared core) into a single JS file that runs on
 * any Node 20+ machine: `node packages/relay/dist/relay.mjs`.
 */
import { build } from 'esbuild';
import { mkdirSync } from 'node:fs';

mkdirSync('packages/relay/dist', { recursive: true });

await build({
  entryPoints: ['packages/relay/src/main.ts'],
  outfile: 'packages/relay/dist/relay.mjs',
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'esm',
  sourcemap: false,
  legalComments: 'none',
  // libsodium ships UMD + embedded wasm; leave it to node_modules (npm ci in Docker)
  external: ['bufferutil', 'utf-8-validate', 'libsodium-wrappers-sumo'],
  // `ws` and libsodium are CommonJS and use require() for node builtins; an ESM
  // bundle needs a createRequire shim so those calls keep working.
  banner: {
    js: [
      '#!/usr/bin/env node',
      "import { createRequire as __meshCreateRequire } from 'node:module';",
      'const require = __meshCreateRequire(import.meta.url);',
    ].join('\n'),
  },
  logLevel: 'info',
});

console.log('relay bundle → packages/relay/dist/relay.mjs');
