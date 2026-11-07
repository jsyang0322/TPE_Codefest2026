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
  <form v-if="mockMicWaiting" class="flex w-full max-w-xl gap-2" @submit.prevent="submit">
    <label for="mock-speech" class="sr-only">用打字代替說話</label>
    <input
      id="mock-speech"
      v-model="text"
      class="min-h-12 min-w-0 flex-1 rounded-xl border-2 border-grayscale-200 bg-white px-4 text-lg"
      placeholder="（瀏覽器模式）打字代替說話"
      autocomplete="off"
      autofocus
    />
    <button type="submit" class="min-h-12 min-w-12 rounded-xl bg-grayscale-800 px-4 text-lg font-semibold text-white">
      送出
    </button>
  </form>
</template>
