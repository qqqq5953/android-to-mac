import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    host: true,
    // 開發時把 API 轉給 Mac 端 server
    proxy: { '/api': 'http://localhost:8765' },
  },
});
