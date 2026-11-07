<script setup lang="ts">
import { computed, onMounted } from 'vue';
import { useAssistant, phaseLabel, save } from '../stores/assistant';
import { isOnline } from '../composables/online';
import { scripts } from '../agent';
import { inApp } from '../bridge';
import TaskCard from '../components/TaskCard.vue';
import MockSpeechInput from '../components/MockSpeechInput.vue';
import AppIcon from '../components/AppIcon.vue';

const assistant = useAssistant();
onMounted(() => assistant.init());
// 每次狀態改變就存一份，頁面被回收重新載入時還原
assistant.$subscribe((_, state) => save(state));

const busy = computed(() => assistant.phase !== 'idle');
const micLabel = computed(() => (busy.value ? '停止' : '按這裡說話'));

/** 有選項按鈕時，狀態列提醒也可以用按的 */
const statusText = computed(() =>
  assistant.choices.length && assistant.phase === 'listening' ? '聆聽中，請說話或按下方按鈕' : phaseLabel[assistant.phase],
);

/**
 * 等 LLM 時顯示已經等了幾秒，使用者知道助手沒有當掉。
 * 和 statusText 分開：狀態列是 aria-live，秒數放進去的話螢幕閱讀器會每秒念一次。
 */
const thinkingSecondsText = computed(() =>
  assistant.phase === 'thinking' && assistant.thinkingSeconds >= 2 ? `（${assistant.thinkingSeconds} 秒）` : '',
);
</script>

<template>
  <!-- 頁面左右邊距 16px，與城市通各頁一致 -->
  <!-- 底部操作列有選項按鈕時會變高，下方留白跟著加大，內容才不會被擋住 -->
  <main
    class="mx-auto flex min-h-dvh max-w-xl flex-col gap-4 px-4 pt-4"
    :class="assistant.choices.length ? 'pb-96' : 'pb-40'"
  >
    <!-- App 的標題列已經顯示服務名稱，這裡的標題給螢幕閱讀器用 -->
    <h1 class="sr-only">AI 語音助手</h1>

    <!-- 沒有網路：AI 推論在手機上，仍可使用 -->
    <p v-if="!isOnline" class="tp-card flex gap-3 border-l-4 border-secondary-500 text-lg leading-relaxed" role="status">
      <AppIcon name="offline" class="mt-1 text-secondary-700" />
      <span><strong>目前沒有網路。</strong>您仍然可以問我問題；查詢停車費等服務需要網路。</span>
    </p>

    <!-- 目前狀態：文字＋圖示，不用閃爍動畫 -->
    <p
      class="tp-tag self-start"
      :class="busy ? 'bg-secondary-100 text-secondary-800' : 'bg-primary-100 text-primary-700'"
    >
      <span role="status" aria-live="polite">{{ statusText }}</span>
      <span v-if="thinkingSecondsText" aria-hidden="true">{{ thinkingSecondsText }}</span>
    </p>

    <!-- 模型狀態：載入中提示進度；評審問「AI 在哪裡跑」時也看得到 -->
    <p v-if="assistant.llmState === 'loading'" class="text-base text-grayscale-600" role="status">
      手機上的 AI 模型{{ assistant.llmProgress ? `下載中（${assistant.llmProgress}%）` : '載入中' }}，先可以用下方按鈕選擇要辦的事。
    </p>
    <!-- 下載失敗不是死路：按重試會再送 llm_status，App 會重新下載（比賽現場網路不穩時用得到） -->
    <section v-else-if="assistant.llmState === 'missing'" class="tp-card flex flex-col gap-3 border-l-4 border-red-500" role="alert">
      <p class="text-lg leading-relaxed">
        <strong>AI 模型下載失敗</strong>（通常是沒有網路）。接上網路後按「重試」；在那之前可以用下方按鈕選擇要辦的事。
      </p>
      <button type="button" class="tp-btn-secondary self-start" @click="assistant.retryLlm()">重試下載</button>
      <details v-if="assistant.llmMessage" class="text-base text-grayscale-600">
        <summary class="min-h-12 cursor-pointer py-3">技術訊息（給工作人員）</summary>
        <p class="break-words">{{ assistant.llmMessage }}</p>
      </details>
    </section>

    <!-- 字幕：使用者說的話、助手念的話都顯示在這裡（聽障者也能使用） -->
    <section class="tp-card min-h-32 p-5" aria-label="字幕" aria-live="polite">
      <p v-if="assistant.caption" class="text-2xl leading-relaxed font-semibold break-words">
        {{ assistant.caption }}
      </p>
      <p v-else class="text-xl leading-relaxed text-grayscale-600">
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
        class="tp-btn-secondary justify-start text-left text-xl"
        :disabled="busy"
        @click="assistant.startScript(script)"
      >
        {{ script.description }}
      </button>
    </section>

    <!-- 對話紀錄 -->
    <section v-if="assistant.log.length" aria-labelledby="log-title" class="flex flex-col gap-2">
      <div class="flex items-center justify-between">
        <h2 id="log-title" class="text-lg font-semibold">對話紀錄</h2>
        <!-- 對話或操作進行中不能清除：流程還在跑，清掉會讓後面的步驟出錯 -->
        <button
          type="button"
          class="min-h-12 px-3 text-base font-semibold text-primary-700 underline disabled:text-grayscale-400 disabled:no-underline"
          :disabled="busy"
          @click="assistant.clear()"
        >
          清除紀錄
        </button>
      </div>
      <ol class="flex flex-col gap-2">
        <li
          v-for="(entry, index) in assistant.log"
          :key="index"
          class="max-w-[85%] rounded-[10px] px-4 py-3 text-lg leading-relaxed"
          :class="entry.role === 'user' ? 'self-end bg-primary-700 text-white' : 'self-start bg-white shadow-card'"
        >
          <span class="sr-only">{{ entry.role === 'user' ? '您說：' : '助手說：' }}</span>
          {{ entry.text }}
        </li>
      </ol>
    </section>
  </main>

  <!-- 底部操作列：與城市通底部按鈕列相同的白底＋上方陰影 -->
  <footer
    class="fixed inset-x-0 bottom-0 bg-white px-4 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-[0_-2px_6px_rgb(0_0_0/0.08)]"
  >
    <div class="mx-auto flex max-w-xl flex-col gap-3">
      <!-- 選項按鈕：按下等於說出按鈕上的字。兩個選項並排，三個以上（付款方式）直排，長字才放得下 -->
      <section v-if="assistant.choices.length" aria-labelledby="choices-title">
        <h2 id="choices-title" class="mb-2 text-base font-semibold text-grayscale-700">也可以直接按</h2>
        <div class="grid gap-3" :class="assistant.choices.length === 2 ? 'grid-cols-2' : 'grid-cols-1'">
          <button
            v-for="choice in assistant.choices"
            :key="choice"
            type="button"
            class="tp-btn-secondary text-xl"
            @click="assistant.pickChoice(choice)"
          >
            {{ choice }}
          </button>
        </div>
      </section>
      <MockSpeechInput v-if="!inApp" />
      <!-- 主按鈕：整排寬、高 72px，手部不便也容易按到 -->
      <button
        type="button"
        class="min-h-18 gap-3 text-2xl"
        :class="busy ? 'tp-btn-danger' : 'tp-btn-primary'"
        @click="assistant.talk()"
      >
        {{ micLabel }}
      </button>
    </div>
  </footer>
</template>
