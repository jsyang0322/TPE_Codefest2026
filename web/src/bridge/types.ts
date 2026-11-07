// Bridge 訊息型別，對應 docs/系統設計文件.md 第三節。

export type ReplyStatus = 'partial' | 'done' | 'error';

export interface BridgeReply {
  id?: string;
  status: ReplyStatus;
  code?: string;
  message?: string;
  [key: string]: unknown;
}

export interface BridgeError {
  status: 'error';
  code: string;
  message?: string;
  step?: number;
}

export interface RequestOptions {
  onPartial?: (data: BridgeReply) => void;
  timeoutMs?: number;
}

/** 任務腳本（web/src/agent/scripts/*.json） */
export interface TaskScript {
  id: string;
  description: string;
  /** label：放進 LLM prompt 的欄位說明（沒有 options 時用） */
  slots: Record<string, { ask: string; label?: string; options?: string[]; pattern?: string }>;
  steps: TaskStep[];
  /** 做完後可以接著做的腳本（例如查完停車費接著繳費），見 agent/followup.ts */
  next?: FollowUpSpec;
}

export interface FollowUpSpec {
  /** 接著執行的腳本 id（agent/index.ts 的 followUpScripts） */
  script: string;
  /** 結果裡這個欄位是非空陣列才接著問，例如有帳單才問要不要繳 */
  when: string;
  /** 先問要不要做 */
  ask: string;
  /** 執行前複誦確認；{欄位} 換成關鍵字或結果的摘要（例如 {total}） */
  confirm: string;
}

export type TaskStep = Record<string, unknown> & { say?: string };

/** TownPass assets/mock_data/account.json 的 data 欄位 */
export interface UserInfo {
  realName: string;
  idNo: string;
  phoneNo: string;
  birthday: string;
  residentAddress: string;
  citizen: boolean;
  nativePeople: boolean;
  [key: string]: unknown;
}
