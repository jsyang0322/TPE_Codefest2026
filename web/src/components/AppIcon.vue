<script setup lang="ts">
// 本服務自繪的線條圖示（24×24、線寬 2、顏色跟著文字），不載入外部圖示庫或字型。
// 圖示一律搭配文字使用，所以對螢幕閱讀器隱藏。目前只有「沒有網路」提示卡使用。

export type IconName = 'offline';

withDefaults(defineProps<{ name: IconName; size?: number | string }>(), { size: 24 });
</script>

<template>
  <svg
    :width="size"
    :height="size"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
    focusable="false"
    class="shrink-0"
  >
    <!-- 沒有網路 -->
    <template v-if="name === 'offline'">
      <path d="M3 3l18 18" />
      <path d="M8.5 15.5a5 5 0 0 1 6.2-.6" />
      <path d="M5 12a10 10 0 0 1 4.6-2.4" />
      <path d="M14.5 9.7A10 10 0 0 1 19 12" />
      <circle cx="12" cy="19" r="1" fill="currentColor" stroke="none" />
    </template>
  </svg>
</template>
