// 助手的畫面狀態：目前在做什麼、字幕、對話紀錄、任務進度。
// 流程（聽 → 理解 → 補齊關鍵字 → 執行 → 念出結果）串在 talk() 裡；理解與問答交給 agent/。

import { defineStore } from 'pinia';
import { bridge } from '../bridge';
import type { TaskScript } from '../bridge/types';
import { answer, describeResult, matchCommand, normalizeSlot, understand } from '../agent';

export type Phase = 'idle' | 'listening' | 'thinking' | 'speaking' | 'running';

export interface LogEntry {
  role: 'user' | 'assistant';
  text: string;
}

export interface TaskProgress {
  description: string;
  steps: string[];
  status: 'running' | 'done' | 'failed' | 'stopped';
  result?: string;
}

export const phaseLabel: Record<Phase, string> = {
  idle: '請按下方按鈕說話',
  listening: '聆聽中，請說話',
  thinking: '思考中，請稍等',
  speaking: '說話中',
  running: 'AI 操作中',
};

export const useAssistant = defineStore('assistant', {
  state: () => ({
    phase: 'idle' as Phase,
    /** 正在說的話（即時字幕）或助手正在念的話 */
    caption: '',
    log: [] as LogEntry[],
    task: null as TaskProgress | null,
    llmState: 'loading' as 'missing' | 'loading' | 'ready' | 'unavailable',
    /** 連續聽不懂的次數，第二次就顯示任務大按鈕 */
    misses: 0,
  }),

  getters: {
    showTaskButtons: (state) => state.misses >= 2 || state.llmState !== 'ready',
  },

  actions: {
    /** 網頁一打開就預熱模型 */
    async init() {
      try {
        this.llmState = await bridge.llmStatus();
      } catch {
        this.llmState = 'unavailable';
      }
    },

    async say(text: string) {
      this.log.push({ role: 'assistant', text });
      this.caption = text;
      this.phase = 'speaking';
      try {
        await bridge.speak(text);
      } catch {
        // 朗讀失敗時字幕仍在畫面上
      }
      this.phase = 'idle';
    },

    /** 聽一句話；失敗回傳空字串 */
    async listen(): Promise<string> {
      this.phase = 'listening';
      this.caption = '';
      try {
        const text = await bridge.listen((partial) => (this.caption = partial));
        if (text) this.log.push({ role: 'user', text });
        return text;
      } catch {
        return '';
      } finally {
        this.phase = 'idle';
      }
    },

    /** 主按鈕：完整的一輪對話 */
    async talk() {
      if (this.phase !== 'idle') return this.stop();

      const text = await this.listen();
      if (!text) return this.say('我沒有聽到，請再按一次按鈕說話。');

      this.phase = 'thinking';
      const intent = await understand(text);

      if (intent.kind === 'question') {
        this.misses = 0;
        this.phase = 'thinking';
        const reply = await answer(intent.question, (partial) => (this.caption = partial));
        return this.say(reply);
      }
      if (intent.kind === 'unknown') {
        this.misses += 1;
        return this.say(
          this.misses >= 2 ? '不好意思，我聽不太懂。您可以直接按下面的按鈕。' : '不好意思，可以再說一次您想做什麼嗎？',
        );
      }

      this.misses = 0;
      await this.runScript(intent.script, intent.slots);
    },

    /** 任務大按鈕或 talk() 呼叫：補齊關鍵字後執行腳本 */
    async runScript(script: TaskScript, slots: Record<string, string> = {}) {
      for (const [key, spec] of Object.entries(script.slots)) {
        let tries = 0;
        while (!slots[key] && tries < 2) {
          await this.say(spec.ask);
          const reply = await this.listen();
          // 「停止」「再說一次」要先判斷，不能當成欄位的值
          const command = reply ? matchCommand(reply) : null;
          if (command === 'stop') return this.say('好的，已經取消。');
          if (command === 'repeat') continue; // 回到迴圈開頭重念 spec.ask，不算一次嘗試
          const value = reply ? normalizeSlot(script, key, reply) : null;
          if (value) slots[key] = value;
          tries += 1;
        }
        if (!slots[key]) return this.say('我還是沒聽清楚，我們晚一點再試一次。');
      }

      this.task = { description: script.description, steps: [], status: 'running' };
      this.phase = 'running';
      try {
        const reply = await bridge.runTask(script, slots, (_step, say) => {
          this.task!.steps.push(say);
          this.caption = say;
        });
        const result = (reply.result ?? {}) as Record<string, unknown>;
        this.task.status = 'done';
        this.task.result = describeResult(script.id, result);
        this.phase = 'idle';
        if (this.task.result) await this.say(this.task.result);
      } catch (error) {
        const code = (error as { code?: string }).code;
        this.task.status = code === 'stopped' ? 'stopped' : 'failed';
        this.phase = 'idle';
        if (code === 'offline') await this.say('目前沒有網路，沒辦法打開服務頁。');
      }
    },

    /** 任何時候都可以停 */
    stop() {
      bridge.stopListening();
      bridge.stopSpeaking();
      if (this.phase === 'running') bridge.stopTask();
      this.phase = 'idle';
    },
  },
});
