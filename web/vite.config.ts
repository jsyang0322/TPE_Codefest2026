import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [vue(), tailwindcss()],
  build: {
    outDir: 'dist',
    rolldownOptions: {
      // 全部打包成一個 JS 檔：評審關網路時，切換畫面不會再去抓其他 chunk。
      output: { codeSplitting: false },
    },
  },
});
