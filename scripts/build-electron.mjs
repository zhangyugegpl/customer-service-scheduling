import { build } from 'esbuild';

const shared = {
  bundle: true,
  sourcemap: true,
  target: 'node22',
  platform: 'node',
  packages: 'external',
  logLevel: 'info',
};

await build({
  ...shared,
  entryPoints: ['apps/desktop/main/index.ts'],
  outfile: 'dist-electron/main.mjs',
  format: 'esm',
  external: ['electron'],
});

await build({
  ...shared,
  entryPoints: ['apps/desktop/preload/index.ts'],
  outfile: 'dist-electron/preload.cjs',
  format: 'cjs',
  external: ['electron'],
});

