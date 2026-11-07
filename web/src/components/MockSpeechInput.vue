<script setup lang="ts">
// 只在電腦瀏覽器出現：App 外沒有語音辨識，用打字代替說話。
import { ref } from 'vue';
import { mockMicWaiting, submitMockSpeech } from '../bridge/mock';

const text = ref('');

function submit() {
  submitMockSpeech(text.value);
  text.value = '';
}
</script>

<template>
  <form v-if="mockMicWaiting" class="flex w-full gap-2" @submit.prevent="submit">
    <label for="mock-speech" class="sr-only">用打字代替說話</label>
    <input
      id="mock-speech"
      v-model="text"
      class="min-h-12 min-w-0 flex-1 rounded-[10px] border border-grayscale-200 bg-white px-4 text-lg focus:border-primary-500"
      placeholder="（瀏覽器模式）打字代替說話"
      autocomplete="off"
      autofocus
    />
    <button type="submit" class="tp-btn-secondary min-h-12">送出</button>
  </form>
</template>
