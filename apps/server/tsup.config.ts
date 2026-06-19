import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  target: 'node20',
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  // Empaquetamos el paquete del workspace para evitar resolver TS en runtime.
  noExternal: ['@vitalsync/shared'],
});
