<script setup lang="ts">
// 目前只有一個畫面，所以不用 vue-router。
// 之後要加畫面時用靜態 import，不要用 () => import()：評審關網路時切換畫面會白屏。
import HomeView from './views/HomeView.vue';
</script>

<template>
  <HomeView />
</template>
