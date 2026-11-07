// 目前有沒有網路。評審關網路測試時，畫面要讓人看出 AI 問答還能用、查詢服務才需要網路。

import { ref } from 'vue';

export const isOnline = ref(typeof navigator === 'undefined' ? true : navigator.onLine);

if (typeof window !== 'undefined') {
  window.addEventListener('online', () => (isOnline.value = true));
  window.addEventListener('offline', () => (isOnline.value = false));
}
