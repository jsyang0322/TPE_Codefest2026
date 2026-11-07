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
