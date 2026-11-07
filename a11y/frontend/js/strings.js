// 使用者會看到或聽到的固定文字（規格第二部分第 3 節：繁體中文、台灣用語、用語淺白）。

const ORDER = ['一', '二', '三'];

/** 念題目時拿掉結尾的問號 */
const plain = (question) => question.replace(/[？?]$/, '');

export const S = {
  intro: '這是常見問題。請按螢幕下半部開始說話，也可以用打字問。',
  introScreenReader: '這是常見問題。可以用打字問，或按「用講的問」按鈕說出問題。',

  talkIdle: '按這裡，用講的問',
  talkListening: '正在聽，請說話',
  talkStopHint: '說完會自動停止，也可以再按一次',

  noSpeech: '沒有聽到聲音。請再按一次，靠近手機說話。',
  micPermission: '台北通沒有麥克風權限。請到手機的設定打開，或改用打字問。',
  micUnavailable: '這支手機目前沒辦法用講的問，請改用打字或點選下面的問題。',

  found: (questions) =>
    `找到 ${questions.length} 個問題。` +
    questions.map((q, i) => `第${ORDER[i]}，${plain(q)}。`).join('') +
    '請說第幾個。',
  outOfRange: (count) => `請說第一個到第${ORDER[count - 1]}個。`,
  choiceLabel: (index, question) => `第${ORDER[index]}，${question}`,

  notFound: '找不到相關的問題。可以換個說法再問一次，或撥打 1999 由專人協助。',
  askAgain: '請再說一次你的問題。',

  answerNextHint: '要聽下一段，請說「下一段」。',
  answerEndHint: '唸完了。要再聽一次，請說「再說一次」。',
  noMoreSegments: '已經是最後一段了。',

  allIntro: (count) => `全部共有 ${count} 個問題，依分類列在畫面上。`,

  loadFailed: '常見問題載入失敗，請確認網路後重新載入。',
  notReady: '常見問題資料還沒準備好，請稍後再重新載入。',
  offlineNote: '目前沒有網路，使用上次下載的常見問題。',
  sourceSynced: (date) => `${date} 更新`,
};

const countdown = (seconds) => {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m ? `還有 ${m} 分 ${s} 秒` : `還有 ${s} 秒`;
};

// 照顧者代操作。被照顧者在同意前聽到的重要內容（同意摘要、確認數字）一律由後端產生，這裡只有固定的引導句。
export const C = {
  talkIdle: '按這裡說話',
  talkListening: '正在聽，請說話',
  talkStopHint: '說完會自動停止，也可以再按一次',
  noSpeech: '沒有聽到聲音。請再按一次，靠近手機說話。',

  elderIntro: '這是讓家人幫忙的頁面。要讓家人幫你操作，請說「讓家人幫我」，或按畫面上的按鈕。',
  codeRenewed: (speak) => `數字已經換成新的。${speak}`,
  codeCountdown: (seconds) => `${countdown(seconds)}，時間到會自動換一組`,
  codeCancelled: '好的，已取消。',
  linkConfirm: (name) => `${name} 要幫你操作，同意嗎？同意請說「同意」，不同意請說「不同意」。`,
  linkTooManyTries: '沒有聽清楚。請按畫面上的「同意」或「不同意」。',
  observeTitle: (name) => `${name} 正在幫你操作`,
  stepLine: (page) => `第 ${page.step} 步，共 ${page.total_steps} 步：${page.step_name}`,
  consentCountdown: (seconds) => `${countdown(seconds)}，沒有回答會自動取消`,
  consentTimeUp: '已經超過時間。',
  revokeAsk: (name) => `確定不讓 ${name} 幫你操作了嗎？確定請說「確定」，不要請說「取消」。`,
  revokeCancelled: '好的，沒有停止。',
  noLink: '目前沒有授權給任何人。',
  notUnderstood: {
    home: '我沒有聽懂。要讓家人幫你操作，請說「讓家人幫我」。',
    code: '要再聽一次數字，請說「再說一次」；不要了請說「取消」。',
    observe: '你可以說「停止授權」、「我自己來」，或「再說一次」。',
    revoke: '請說「確定」或「取消」。',
  },

  waitingElder: '已送出，請家人在他的手機上同意。',
  waitingConsent: (name) => `已請 ${name} 確認付款，請稍候。`,
  waitCountdown: countdown,
  badPlate: '車牌格式不正確，例如 ABC-1234。',
  badCode: '請輸入 6 位數字。',
  notBindQr: '這不是授權用的 QR code。',
  paidResult: (receipt) => `已完成付款（模擬），收據編號 ${receipt}。`,
};
