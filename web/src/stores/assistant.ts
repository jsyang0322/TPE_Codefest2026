// 助手的畫面狀態：目前在做什麼、字幕、對話紀錄、任務進度。
// 流程（聽 → 理解 → 補齊關鍵字 → 執行 → 念出結果）串在 talk() 裡；理解與問答交給 agent/。

import { defineStore } from 'pinia';
import { bridge } from '../bridge';
import type { TaskScript } from '../bridge/types';
import {
  answer,
  describeResult,
  matchCommand,
  matchYesNo,
  nextTask,
  normalizeSlot,
  understand,
  type FollowUp,
} from '../agent';
import { isOnline } from '../composables/online';

export type Phase = 'idle' | 'listening' | 'thinking' | 'speaking' | 'running';

export interface LogEntry {
  role: 'user' | 'assistant';
  text: string;
}

export interface TaskProgress {
  description: string;
  steps: string[];
  /** interrupted：執行途中助手頁被 iOS 回收、重新載入，不知道結果 */
  status: 'running' | 'done' | 'failed' | 'stopped' | 'interrupted';
  result?: string;
}

export const phaseLabel: Record<Phase, string> = {
  idle: '請按下方按鈕說話',
  listening: '聆聽中，請說話',
  thinking: '思考中，請稍等',
  speaking: '說話中',
  running: 'AI 操作中',
};

// ---- 保存對話狀態 ----
// 執行腳本時助手頁在背景，iOS 記憶體不夠會回收它；回來時頁面重新載入，靠 sessionStorage 還原。
// sessionStorage 只存在這次開啟的 WebView，關掉服務就清空，不會留下個資。

const STORAGE_KEY = 'tp-voice-assistant';

interface Saved {
  log: LogEntry[];
  task: TaskProgress | null;
  caption: string;
}

function load(): Saved | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const saved = JSON.parse(raw) as Saved;
    if (saved.task?.status === 'running') saved.task.status = 'interrupted';
    return saved;
  } catch {
    return null;
  }
}

export function save(state: Saved) {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ log: state.log, task: state.task, caption: state.caption }));
  } catch {
    // 無痕模式或儲存空間滿了：不保存，功能照常
  }
}

const restored = load();

export const useAssistant = defineStore('assistant', {
  state: () => ({
    phase: 'idle' as Phase,
    /** 正在說的話（即時字幕）或助手正在念的話 */
    caption: restored?.caption ?? '',
    log: (restored?.log ?? []) as LogEntry[],
    task: (restored?.task ?? null) as TaskProgress | null,
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

    /** 開服務頁需要網路；沒有網路時說明並回傳 false。要在問使用者任何問題之前檢查 */
    async ensureOnline(): Promise<boolean> {
      if (isOnline.value) return true;
      await this.say('目前沒有網路，沒辦法打開服務頁。您還是可以問我規定相關的問題。');
      return false;
    },

    /** 缺什麼問什麼，直接改 slots；取消或兩次都聽不懂時回傳 false */
    async fillSlots(script: TaskScript, slots: Record<string, string>): Promise<boolean> {
      for (const [key, spec] of Object.entries(script.slots)) {
        let tries = 0;
        while (!slots[key] && tries < 2) {
          await this.say(spec.ask);
          const reply = await this.listen();
          // 「停止」「再說一次」要先判斷，不能當成欄位的值
          const command = reply ? matchCommand(reply) : null;
          if (command === 'stop') {
            await this.say('好的，已經取消。');
            return false;
          }
          if (command === 'repeat') continue; // 回到迴圈開頭重念 spec.ask，不算一次嘗試
          const value = reply ? normalizeSlot(script, key, reply) : null;
          if (value) slots[key] = value;
          tries += 1;
        }
        if (!slots[key]) {
          await this.say('我還是沒聽清楚，我們晚一點再試一次。');
          return false;
        }
      }
      return true;
    },

    /** 問是非題；說「對」回傳 true，說「不」、取消或兩次都聽不懂回傳 false */
    async askYesNo(question: string): Promise<boolean> {
      let tries = 0;
      while (tries < 2) {
        await this.say(question);
        const reply = await this.listen();
        const command = reply ? matchCommand(reply) : null;
        if (command === 'stop') return false;
        if (command === 'repeat') continue; // 重念問題，不算一次嘗試
        const yesNo = reply ? matchYesNo(reply) : null;
        if (yesNo) return yesNo === 'yes';
        tries += 1;
      }
      return false;
    },

    /** 接續的腳本（例如繳費）：先問要不要做，補齊關鍵字，複誦確認後才執行 */
    async offerNext(next: FollowUp) {
      // 查詢後才斷網：先講清楚，不要等使用者說「確定」才發現不能繳
      if (!isOnline.value) return this.say('目前沒有網路，沒辦法接著幫您處理，網路恢復後再跟我說。');
      if (!(await this.askYesNo(next.ask))) return this.say('好的，需要的時候再跟我說。');
      const slots = { ...next.slots };
      if (!(await this.fillSlots(next.script, slots))) return;
      if (!(await this.askYesNo(next.confirm(slots)))) return this.say('好的，先不幫您處理。');
      await this.runScript(next.script, slots);
    },

    /** 任務大按鈕或 talk() 呼叫：補齊關鍵字後執行腳本；做完若有接續的腳本就接著問 */
    async runScript(script: TaskScript, slots: Record<string, string> = {}) {
      if (!(await this.ensureOnline())) return;
      if (!(await this.fillSlots(script, slots))) return;

      this.task = { description: script.description, steps: [], status: 'running' };
      // 用區域變數：執行途中 this.task 可能被 clear() 設成 null
      const task = this.task;
      this.phase = 'running';
      try {
        const reply = await bridge.runTask(script, slots, (_step, say) => {
          task.steps.push(say);
          this.caption = say;
        });
        const result = (reply.result ?? {}) as Record<string, unknown>;
        task.status = 'done';
        task.result = describeResult(script.id, result);
        this.phase = 'idle';
        if (task.result) await this.say(task.result);
        const next = nextTask(script, result, slots);
        if (next) await this.offerNext(next);
      } catch (error) {
        const code = (error as { code?: string }).code;
        task.status = code === 'stopped' ? 'stopped' : 'failed';
        this.phase = 'idle';
        if (code === 'offline') await this.say('目前沒有網路，沒辦法打開服務頁。');
      }
    },

    /** 清除對話紀錄 */
    clear() {
      this.stop();
      this.log = [];
      this.task = null;
      this.caption = '';
      this.misses = 0;
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
