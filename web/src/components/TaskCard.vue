<script setup lang="ts">
import type { TaskProgress } from '../stores/assistant';

defineProps<{ task: TaskProgress }>();

const statusText: Record<TaskProgress['status'], string> = {
  running: 'AI 操作中',
  done: '完成',
  failed: '這一步沒有成功，您可以自己接著操作',
  stopped: '已停止',
  interrupted: '畫面重新載入了，結果請看服務頁',
};

const statusClass: Record<TaskProgress['status'], string> = {
  running: 'bg-secondary-100 text-secondary-800',
  done: 'bg-primary-100 text-primary-700',
  failed: 'bg-red-50 text-red-600',
  stopped: 'bg-grayscale-100 text-grayscale-700',
  interrupted: 'bg-grayscale-100 text-grayscale-700',
};
</script>

<template>
  <section class="tp-card p-5" aria-labelledby="task-title">
    <div class="flex flex-wrap items-center justify-between gap-2">
      <h2 id="task-title" class="text-xl font-semibold">{{ task.description }}</h2>
      <p class="tp-tag" :class="statusClass[task.status]">{{ statusText[task.status] }}</p>
    </div>

    <ol class="mt-4 flex flex-col gap-3" aria-label="操作步驟">
      <li v-for="(step, index) in task.steps" :key="index" class="flex gap-3 text-lg leading-relaxed">
        <span
          class="flex size-8 shrink-0 items-center justify-center rounded-full text-base font-semibold"
          :class="
            index === task.steps.length - 1 && task.status === 'running'
              ? 'bg-secondary-500 text-grayscale-800'
              : 'bg-primary-100 text-primary-700'
          "
          aria-hidden="true"
        >
          {{ index + 1 }}
        </span>
        <span>{{ step }}</span>
      </li>
    </ol>

    <div v-if="task.result" class="mt-4 rounded-[10px] bg-primary-50 p-4">
      <h3 class="text-base font-semibold text-primary-700">查詢結果</h3>
      <p class="mt-1 text-xl leading-relaxed whitespace-pre-line">{{ task.result }}</p>
    </div>
  </section>
</template>
