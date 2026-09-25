import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const workspaceRoot = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: path.join(workspaceRoot, 'apps/desktop/renderer'),
  // Electron 生产环境通过 file:// 加载页面，静态资源必须使用相对路径。
  base: './',
  plugins: [react()],
  resolve: {
    alias: {
      '@contracts': path.join(workspaceRoot, 'packages/contracts'),
      '@domain': path.join(workspaceRoot, 'packages/domain'),
    },
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
  },
  build: {
    outDir: path.join(workspaceRoot, 'dist/renderer'),
    emptyOutDir: true,
  },
});
