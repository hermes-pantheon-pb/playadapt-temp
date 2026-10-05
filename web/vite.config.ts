import { defineConfig } from 'vite';
import path from 'path';

export default defineConfig({
  define: {
    'process.env.NODE_ENV': JSON.stringify('production')
  },
  build: {
    outDir: path.resolve(__dirname, '../src/Jellyfin.Plugin.PlayAdapt/Web'),
    emptyOutDir: true,
    lib: {
      entry: path.resolve(__dirname, 'src/index.ts'),
      name: 'JellyfinPlayAdaptPlugin',
      formats: ['iife'],
      fileName: () => 'playadapt.bundle.js'
    },
    rollupOptions: {
      output: {
        assetFileNames: (assetInfo) => {
          if (assetInfo.name && assetInfo.name.endsWith('.css')) {
            return 'playadapt.bundle.css';
          }
          return '[name][extname]';
        }
      }
    }
  }
});
