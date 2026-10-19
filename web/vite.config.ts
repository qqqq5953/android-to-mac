import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    // 開發時把 API 轉給 Mac 端 server
    proxy: { '/api': 'http://localhost:8765' },
  },
});
