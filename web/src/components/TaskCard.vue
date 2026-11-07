<script setup lang="ts">
import type { TaskProgress } from '../stores/assistant';

defineProps<{ task: TaskProgress }>();

const statusText: Record<TaskProgress['status'], string> = {
  running: 'AI 操作中',
  done: '完成',
  failed: '這一步沒有成功，您可以自己接著操作',
  stopped: '已停止',
};
</script>

<template>
  <section class="rounded-2xl border-2 border-secondary-500 bg-white p-5" aria-labelledby="task-title">
    <h2 id="task-title" class="text-xl font-semibold">{{ task.description }}</h2>
    <p class="mt-1 text-base font-semibold" :class="task.status === 'failed' ? 'text-danger-500' : 'text-primary-700'">
      {{ statusText[task.status] }}
    </p>

    <ol class="mt-3 flex flex-col gap-2" aria-label="操作步驟">
      <li v-for="(step, index) in task.steps" :key="index" class="flex gap-3 text-lg leading-relaxed">
        <span
          class="flex size-8 shrink-0 items-center justify-center rounded-full text-base font-semibold"
          :class="index === task.steps.length - 1 && task.status === 'running' ? 'bg-secondary-500 text-grayscale-800' : 'bg-primary-100 text-primary-900'"
          aria-hidden="true"
        >
          {{ index + 1 }}
        </span>
        <span>{{ step }}</span>
      </li>
    </ol>

    <div v-if="task.result" class="mt-4 rounded-xl bg-primary-50 p-4">
      <h3 class="text-base font-semibold text-primary-900">查詢結果</h3>
      <p class="mt-1 text-xl leading-relaxed whitespace-pre-line">{{ task.result }}</p>
    </div>
  </section>
</template>
