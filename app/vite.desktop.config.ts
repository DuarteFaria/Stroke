import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/postcss';
import { fileURLToPath } from 'node:url';
import { themeBootstrap } from './app/theme';
export default defineConfig({
  root: fileURLToPath(new URL('./desktop-ui', import.meta.url)),
  resolve: { alias: { '@': fileURLToPath(new URL('.', import.meta.url)) } },
  css: { postcss: { plugins: [tailwindcss()] } },
  plugins: [
    react(),
    {
      // The desktop bundle has no layout.tsx, so the theme has to be stamped on
      // <html> here instead. It ships as a file rather than an inline script
      // because the desktop server sends `script-src 'self'`, and as a classic
      // (non-module) script in the head so it runs before the first paint.
      name: 'stroke-theme-bootstrap',
      generateBundle() {
        this.emitFile({ type: 'asset', fileName: 'theme.js', source: themeBootstrap });
      },
      transformIndexHtml: () => [
        { tag: 'script', attrs: { src: '/theme.js' }, injectTo: 'head-prepend' as const },
      ],
    },
  ],
  build: { outDir: '../desktop-dist', emptyOutDir: true },
});
