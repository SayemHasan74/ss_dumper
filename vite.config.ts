import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  root: 'web',
  plugins: [preact(), tailwindcss()],
  server: {
    port: 5173,
    proxy: { '/api': 'http://localhost:8787' },
  },
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    target: 'es2022',
    sourcemap: false,
    cssCodeSplit: false,
  },
});
