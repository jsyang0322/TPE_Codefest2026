<script setup lang="ts">
import { computed, onMounted } from 'vue';
import { useAssistant, phaseLabel } from '../stores/assistant';
import { scripts } from '../agent';
import { inApp } from '../bridge';
import TaskCard from '../components/TaskCard.vue';
import MockSpeechInput from '../components/MockSpeechInput.vue';

const assistant = useAssistant();
onMounted(() => assistant.init());

const busy = computed(() => assistant.phase !== 'idle');
const micLabel = computed(() => (busy.value ? '停止' : '按我說話'));

const phaseIcon: Record<string, string> = {
  idle: '🎙️',
  listening: '👂',
  thinking: '💭',
  speaking: '🔊',
  running: '🤖',
};
</script>

<template>
  <main class="mx-auto flex min-h-dvh max-w-xl flex-col gap-4 px-4 pt-4 pb-44">
    <!-- App 的標題列已經顯示服務名稱，這裡的標題給螢幕閱讀器用 -->
    <h1 class="sr-only">AI 語音助手</h1>

    <!-- 目前狀態：文字＋圖示，不用閃爍動畫 -->
    <p
      class="flex items-center gap-2 self-start rounded-full px-4 py-2 text-base font-semibold"
      :class="busy ? 'bg-secondary-100 text-grayscale-800' : 'bg-primary-100 text-primary-900'"
      role="status"
      aria-live="polite"
    >
      <span aria-hidden="true">{{ phaseIcon[assistant.phase] }}</span>
      {{ phaseLabel[assistant.phase] }}
    </p>

    <!-- 字幕：使用者說的話、助手念的話都顯示在這裡（聽障者也能使用） -->
    <section
      class="min-h-32 rounded-2xl bg-white p-5 shadow-sm"
      aria-label="字幕"
      aria-live="polite"
    >
      <p v-if="assistant.caption" class="text-2xl leading-relaxed font-semibold break-words">
        {{ assistant.caption }}
      </p>
      <p v-else class="text-xl leading-relaxed text-grayscale-500">
        您可以說：「幫我查停車費，車號 ABC 123」
      </p>
    </section>

    <TaskCard v-if="assistant.task" :task="assistant.task" />

    <!-- 聽不懂兩次或模型不可用時，直接用按鈕選任務 -->
    <section v-if="assistant.showTaskButtons" aria-labelledby="task-buttons-title" class="flex flex-col gap-3">
      <h2 id="task-buttons-title" class="text-lg font-semibold">或直接選擇要辦的事</h2>
      <button
        v-for="script in scripts"
        :key="script.id"
        type="button"
        class="min-h-14 rounded-2xl border-2 border-primary-500 bg-white px-5 text-left text-xl font-semibold text-primary-900 active:bg-primary-50 disabled:opacity-50"
        :disabled="busy"
        @click="assistant.runScript(script)"
      >
        {{ script.description }}
      </button>
    </section>

    <!-- 對話紀錄 -->
    <section v-if="assistant.log.length" aria-labelledby="log-title" class="flex flex-col gap-2">
      <h2 id="log-title" class="text-lg font-semibold">對話紀錄</h2>
      <ol class="flex flex-col gap-2">
        <li
          v-for="(entry, index) in assistant.log"
          :key="index"
          class="max-w-[85%] rounded-2xl px-4 py-3 text-lg leading-relaxed"
          :class="entry.role === 'user' ? 'self-end bg-primary-500 text-white' : 'self-start bg-white'"
        >
          <span class="sr-only">{{ entry.role === 'user' ? '您說：' : '助手說：' }}</span>
          {{ entry.text }}
        </li>
      </ol>
    </section>
  </main>

  <!-- 固定在底部的大按鈕 -->
  <footer class="fixed inset-x-0 bottom-0 flex flex-col items-center gap-3 bg-gradient-to-t from-grayscale-50 via-grayscale-50 to-transparent px-4 pt-6 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
    <MockSpeechInput v-if="!inApp" />
    <button
      type="button"
      class="flex size-28 flex-col items-center justify-center rounded-full text-white shadow-lg active:scale-95"
      :class="busy ? 'bg-danger-500' : 'bg-primary-500'"
      :aria-label="micLabel"
      @click="assistant.talk()"
    >
      <span class="text-4xl" aria-hidden="true">{{ busy ? '⏹' : '🎙️' }}</span>
      <span class="text-base font-semibold">{{ micLabel }}</span>
    </button>
  </footer>
</template>
