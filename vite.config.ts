import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
import tailwindcss from '@tailwindcss/vite';
import packageInfo from './package.json' with { type: 'json' };

export default defineConfig({
  root: 'web',
  plugins: [preact(), tailwindcss()],
  define: { __APP_VERSION__: JSON.stringify(packageInfo.version), __BUILD_DATE__: JSON.stringify(new Date().toISOString().slice(0, 10)) },
  server: {
    port: 5173,
    proxy: { '/api': { target: 'http://localhost:8787', changeOrigin: false } },
  },
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    target: 'es2022',
    sourcemap: false,
    cssCodeSplit: false,
    modulePreload: { polyfill: false },
  },
});
