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
import { CONFIRM_LABELS, YES_NO_LABELS } from './choices';

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

// ---- 選項按鈕 ----
// 助手問是非題或選擇題時，畫面同時顯示大按鈕；按按鈕和用說的都能回答。
// 給構音障礙、會場太吵、手機不支援離線聽寫的使用者用。
// 這兩個變數不放進 state：它們是流程內部的暫存，不需要畫面反應、也不該被保存。

/** listen() 正在等答案時，按鈕用這個直接把答案交給它 */
let choiceResolve: ((text: string) => void) | null = null;
/** 題目還在念的時候就按了按鈕：先存著，listen() 一開始就直接拿走 */
let pendingChoice: string | null = null;
/** 這一輪已經念過「好的，我想一下」：理解完接著問答時不再念一次 */
let hintSpoken = false;
/**
 * 第幾輪對話。開始新的一輪或按停止時加一；等 LLM 回來後比對，不一樣就表示這輪已經被停掉，
 * 結果直接丟掉。只靠 cancelled 不夠：停止後馬上再按說話，新的一輪會把 cancelled 設回 false。
 */
let turn = 0;
/** think() 的計時器；放在這裡，stop() 才清得掉 */
let thinkTimers: { tick: ReturnType<typeof setInterval>; hint: ReturnType<typeof setTimeout> } | null = null;

function clearThinkTimers() {
  if (!thinkTimers) return;
  clearInterval(thinkTimers.tick);
  clearTimeout(thinkTimers.hint);
  thinkTimers = null;
}

/** 思考超過這麼久就先念一句，讓使用者知道助手有在做事 */
const THINKING_HINT_MS = 2000;

export const useAssistant = defineStore('assistant', {
  state: () => ({
    phase: 'idle' as Phase,
    /** 正在說的話（即時字幕）或助手正在念的話 */
    caption: restored?.caption ?? '',
    log: (restored?.log ?? []) as LogEntry[],
    task: (restored?.task ?? null) as TaskProgress | null,
    llmState: 'loading' as 'missing' | 'loading' | 'ready' | 'unavailable',
    /** 模型下載進度（0–100），App 有提供時才有值；從手機檔案載入時是 0 */
    llmProgress: null as number | null,
    /** App 回報的上次失敗原因（原始錯誤訊息，給隊員看，不念給使用者聽） */
    llmMessage: null as string | null,
    /** 正在輪詢 llm_status，避免重試按鈕連按開出好幾個輪詢 */
    llmPolling: false,
    /** 裝置不支援離線語音辨識或沒有麥克風權限：改用任務大按鈕 */
    voiceUnavailable: false,
    /** 連續聽不懂的次數，第二次就顯示任務大按鈕 */
    misses: 0,
    /**
     * 使用者按了停止。stop() 只能讓「這一次」的朗讀、聆聽結束，流程本身還在 await 鏈上；
     * 所以設這個旗標，say()、listen() 和各流程看到就收手。新的一輪（talk、任務按鈕）開始時重設。
     */
    cancelled: false,
    /** 目前題目可以直接點的答案；空陣列表示不顯示按鈕 */
    choices: [] as string[],
    /** 這次思考已經等了幾秒，畫面上顯示；不在思考時是 0 */
    thinkingSeconds: 0,
  }),

  getters: {
    showTaskButtons: (state) => state.misses >= 2 || state.llmState !== 'ready' || state.voiceUnavailable,
  },

  actions: {
    /** 網頁一打開就預熱模型 */
    init() {
      return this.pollLlm();
    },

    /**
     * 每 2 秒送一次 llm_status，直到 ready 或 missing。
     * App 收到 llm_status 會立刻回目前狀態並在背景載入（必要時下載），所以要輪詢。
     * missing 代表下載或載入失敗（通常是沒網路），不是死路：retryLlm() 會重新開始。
     */
    async pollLlm() {
      if (this.llmPolling) return;
      this.llmPolling = true;
      try {
        const deadline = Date.now() + 15 * 60 * 1000;
        while (Date.now() < deadline) {
          try {
            const { state, progress, message } = await bridge.llmStatus();
            this.llmState = state;
            this.llmProgress = progress;
            this.llmMessage = message;
            if (state !== 'loading') return;
          } catch {
            // App 沒有 llm_status Handler（例如還沒合併）：當成模型不可用，改用關鍵字
            this.llmState = 'unavailable';
            return;
          }
          await new Promise((resolve) => setTimeout(resolve, 2000));
        }
        this.llmState = 'unavailable';
      } finally {
        this.llmPolling = false;
      }
    },

    /** 重試按鈕：再送一次 llm_status，App 會重新下載或載入模型 */
    retryLlm() {
      this.llmState = 'loading';
      this.llmProgress = null;
      this.llmMessage = null;
      return this.pollLlm();
    },

    async say(text: string) {
      if (this.cancelled) return;
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

    /** 聽一句話；有顯示選項按鈕時，按按鈕也算回答。失敗回傳空字串 */
    async listen(): Promise<string> {
      if (this.cancelled) return '';
      if (pendingChoice !== null) {
        const text = pendingChoice;
        pendingChoice = null;
        this.log.push({ role: 'user', text });
        return text;
      }
      this.phase = 'listening';
      // 不清空字幕：題目要一直看得到（聽障者靠字幕），使用者開口後才由即時辨識的文字換掉
      let picked = false;
      const byButton = new Promise<string>((resolve) => {
        choiceResolve = (text) => {
          picked = true;
          resolve(text);
        };
      });
      try {
        const text = await Promise.race([
          bridge.listen((partial) => {
            if (!picked && partial) this.caption = partial;
          }),
          byButton,
        ]);
        if (text) this.log.push({ role: 'user', text });
        return text;
      } catch (error) {
        const code = (error as { code?: string }).code;
        if (code === 'unavailable' || code === 'permission') this.voiceUnavailable = true;
        return '';
      } finally {
        choiceResolve = null;
        this.phase = 'idle';
      }
    },

    /** 顯示選項按鈕；換題時先清掉上一題沒用到的答案 */
    showChoices(choices: string[]) {
      pendingChoice = null;
      this.choices = choices;
    },

    hideChoices() {
      pendingChoice = null;
      this.choices = [];
    },

    /** 使用者按了選項按鈕 */
    pickChoice(text: string) {
      if (!this.choices.includes(text)) return;
      this.choices = [];
      this.caption = text;
      if (choiceResolve) {
        // 正在聽：結束聆聽，直接用按鈕的答案
        const resolve = choiceResolve;
        choiceResolve = null;
        bridge.stopListening();
        resolve(text);
      } else {
        // 題目還在念：停止朗讀，listen() 一開始就會拿到這個答案
        pendingChoice = text;
        bridge.stopSpeaking();
      }
    },

    /** 主按鈕：完整的一輪對話 */
    async talk() {
      if (this.phase !== 'idle') return this.stop();
      this.cancelled = false;
      const myTurn = ++turn;

      if (this.voiceUnavailable) {
        return this.say('這支手機目前沒辦法離線聽寫，請直接按下面的按鈕選擇要辦的事。');
      }
      const text = await this.listen();
      if (this.voiceUnavailable) {
        return this.say('這支手機目前沒辦法離線聽寫，請直接按下面的按鈕選擇要辦的事。');
      }
      if (!text) return this.say('我沒有聽到，請再按一次按鈕說話。');

      hintSpoken = false;
      const intent = await this.think(understand(text));
      if (this.cancelled || myTurn !== turn) return; // 思考中按了停止

      if (intent.kind === 'question') {
        this.misses = 0;
        const reply = await this.think(
          answer(intent.question, (partial) => {
            if (!this.cancelled && myTurn === turn) this.caption = partial;
          }),
        );
        if (myTurn !== turn) return;
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

    /**
     * 等 LLM 的期間：顯示「思考中」和已經等了幾秒；超過 2 秒先念「好的，我想一下」。
     * 用關鍵字就判斷出來的句子不會等到 2 秒，所以不會念。
     */
    async think<T>(work: Promise<T>): Promise<T> {
      clearThinkTimers();
      this.phase = 'thinking';
      this.thinkingSeconds = 0;
      const started = Date.now();
      const timers = {
        tick: setInterval(() => (this.thinkingSeconds = Math.floor((Date.now() - started) / 1000)), 1000),
        hint: setTimeout(() => {
          if (this.phase !== 'thinking' || this.cancelled || hintSpoken) return;
          hintSpoken = true;
          // 不用 say()：它會把 phase 改成 speaking；這句也不放進對話紀錄
          bridge.speak('好的，我想一下。').catch(() => {});
        }, THINKING_HINT_MS),
      };
      thinkTimers = timers;
      try {
        return await work;
      } finally {
        // 已經被 stop() 或下一輪換掉的話，不要動到下一輪的計時器和秒數
        if (thinkTimers === timers) {
          clearThinkTimers();
          this.thinkingSeconds = 0;
        }
      }
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
          // 有固定選項的欄位（車種、付款方式）顯示按鈕；車號、書名這類自由回答不顯示
          this.showChoices(spec.options ?? []);
          await this.say(spec.ask);
          const reply = await this.listen();
          this.hideChoices();
          if (this.cancelled) return false; // 按了停止：不再問
          // 先判斷「停止」「再說一次」，不是指令才當成答案（規則見 agent/keywords.ts）
          const command = reply ? matchCommand(reply) : null;
          if (command === 'stop') {
            await this.say('好的，先停在這裡，需要時再按按鈕叫我。');
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

    /**
     * 問是非題；說「對」回傳 true，說「不」、取消或兩次都聽不懂回傳 false。
     * labels 是兩顆按鈕的文字，規則見 stores/choices.ts。
     */
    async askYesNo(question: string, labels: [string, string] = YES_NO_LABELS): Promise<boolean> {
      let tries = 0;
      while (tries < 2) {
        this.showChoices(labels);
        await this.say(question);
        const reply = await this.listen();
        this.hideChoices();
        if (this.cancelled) return false; // 按了停止：當成「不要」
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
      if (!(await this.askYesNo(next.confirm(slots), CONFIRM_LABELS))) return this.say('好的，先不幫您處理。');
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
        // 摘要句（查到 N 筆共 X 元）只有網頁算得出來，由網頁念；
        // 腳本的 stop 已改成短句「查詢完成」，App 端不會重複念到內容
        if (task.result) await this.say(task.result);
        const next = nextTask(script, result, slots);
        if (next && !this.cancelled) await this.offerNext(next);
      } catch (error) {
        const code = (error as { code?: string }).code;
        task.status = code === 'stopped' ? 'stopped' : 'failed';
        this.phase = 'idle';
        if (code === 'offline') await this.say('目前沒有網路，沒辦法打開服務頁。');
      }
    },

    /** 任務大按鈕：開始新的一輪 */
    startScript(script: TaskScript) {
      if (this.phase !== 'idle') return;
      this.cancelled = false;
      turn += 1;
      return this.runScript(script);
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
      this.cancelled = true;
      turn += 1;
      clearThinkTimers();
      this.thinkingSeconds = 0;
      this.hideChoices();
      bridge.stopListening();
      bridge.stopSpeaking();
      if (this.phase === 'running') bridge.stopTask();
      this.phase = 'idle';
    },
  },
});
