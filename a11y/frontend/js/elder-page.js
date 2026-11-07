// 功能 B：被照顧者（例如王阿伯）的頁面。
//
// - 產生數字碼與 QR code（5 分鐘換一組）並念出來
// - 家人輸入後，問「王小美 要幫你操作，同意嗎？」
// - 觀看模式：家人每做一步，畫面跟著同步（唯讀），並念出來、震動
// - 同意請求：特殊震動＋念出內容與確認數字；按兩次按鈕或說「同意＋數字」
// - 隨時可以說「停止授權」「我自己來」
// 看得到畫面的人用按鈕；看不到的人全程用語音與聲音提示。

import { closeDialog, focusOn, openDialog, vibrate } from './a11y.js';
import { api, clearLogin, getToken, getUser, requireLogin } from './api.js';
import { createParkingForm } from './parking-form.js';
import { C, S } from './strings.js';
import { parseCommand } from './voice-commands.js';
import { createVoice, setupMockMic } from './voice-session.js';
import { connectEvents } from './ws.js';

const $ = (id) => document.getElementById(id);
const background = () => [$('main'), $('banner')];

const state = {
  view: 'home',       // home / code / observe
  dialog: null,       // link / consent / revoke
  links: [],
  pendingLink: null,  // 等待同意的授權 { link_id, caregiver_name }
  linkTries: 0,
  consent: null,      // 等待回答的同意請求（後端推送的內容）
  consentConfirming: false,
  revokeLinkId: null,
  observe: null,      // { sessionId, linkId, caregiverName }
  codeSpeak: '',
  timers: {},
};

let voice;
let form;

// ---- 共用 ----

function show(view) {
  for (const name of ['home', 'code', 'observe']) $(`view-${name}`).hidden = name !== view;
  state.view = view;
}

function startCountdown(name, seconds, onTick, onDone) {
  stopCountdown(name);
  const end = Date.now() + seconds * 1000;
  const tick = () => {
    const left = Math.max(0, Math.round((end - Date.now()) / 1000));
    onTick(left);
    if (left <= 0) {
      stopCountdown(name);
      onDone?.();
    }
  };
  tick();
  state.timers[name] = setInterval(tick, 1000);
}

function stopCountdown(name) {
  clearInterval(state.timers[name]);
  delete state.timers[name];
}

function handleError(error) {
  if (error?.status === 401) {
    location.replace('index.html');
    return;
  }
  voice.say(error?.message ?? '發生錯誤，請再試一次。');
}

// ---- 狀態還原（打開頁面、斷線重連時） ----

async function refresh() {
  const { links } = await api('/api/care/links');
  state.links = links;
  renderLinks();

  if (!state.dialog) {
    const pending = links.find((link) => link.status === 'pending');
    if (pending) openLinkDialog({ link_id: pending.link_id, caregiver_name: pending.caregiver.name });
  }

  const withSession = links.find((link) => link.status === 'active' && link.session);
  if (withSession) {
    const { session_id: sessionId, last_page: page } = withSession.session;
    enterObserve({ sessionId, linkId: withSession.link_id, caregiverName: withSession.caregiver.name }, page);
  } else if (state.view === 'observe') {
    exitObserve();
  }

  const withConsent = links.find((link) => link.pending_consent);
  if (withConsent && state.consent?.consent_id !== withConsent.pending_consent.consent_id) {
    openConsentDialog(withConsent.pending_consent);
  }
}

function renderLinks() {
  const active = state.links.filter((link) => link.status === 'active');
  $('links-empty').hidden = active.length > 0;
  $('links-list').replaceChildren(
    ...active.map((link) => {
      const item = document.createElement('li');
      const text = document.createElement('p');
      text.textContent = `${link.caregiver.name} 可以幫你操作`;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'btn btn-danger';
      button.textContent = '終止授權';
      button.setAttribute('aria-label', `終止 ${link.caregiver.name} 的授權`);
      button.addEventListener('click', () => askRevoke(link.link_id));
      item.append(text, button);
      return item;
    }),
  );
}

// ---- 數字碼與 QR code ----

async function showCode({ renewed = false } = {}) {
  let data;
  try {
    data = await api('/api/care/bind-codes', { method: 'POST' });
  } catch (error) {
    handleError(error);
    return;
  }
  state.codeSpeak = data.speak;
  const spaced = data.code.split('').join(' ');
  $('code-digits').textContent = spaced;
  $('code-digits').setAttribute('aria-label', `數字碼 ${spaced}`);
  $('code-qr').innerHTML = data.qr_svg; // 後端用 qrcode 套件產生的 SVG，不含使用者輸入
  startCountdown('code', data.ttl_seconds, (left) => ($('code-countdown').textContent = C.codeCountdown(left)), () =>
    showCode({ renewed: true }),
  );
  if (state.view !== 'code') {
    show('code');
    focusOn($('code-title'));
  }
  if (!state.dialog) voice.sayThenListen(renewed ? C.codeRenewed(data.speak) : data.speak);
}

function leaveCode() {
  stopCountdown('code');
  if (state.view === 'code') show('home');
}

async function cancelCode() {
  leaveCode();
  focusOn($('page-title'));
  api('/api/care/bind-codes', { method: 'DELETE' }).catch(() => {});
  voice.say(C.codeCancelled);
}

// ---- 同意授權 ----

function openLinkDialog(data) {
  leaveCode(); // 數字碼已經被用掉了
  state.pendingLink = data;
  state.linkTries = 0;
  state.dialog = 'link';
  $('dlg-link-title').textContent = `${data.caregiver_name} 要幫你操作，同意嗎？`;
  openDialog($('dlg-link'), { background: background() });
  vibrate('consent');
  voice.sayThenListen(data.speak ?? C.linkConfirm(data.caregiver_name), { urgent: true });
}

function closeLinkDialog() {
  state.pendingLink = null;
  state.dialog = null;
  closeDialog($('dlg-link'), { background: background() });
}

/** body：{ accept: true/false }（按按鈕）或 { transcript }（語音，由後端判斷） */
async function answerLink(body) {
  const link = state.pendingLink;
  if (!link) return;
  let res;
  try {
    res = await api(`/api/care/links/${link.link_id}/confirm`, { method: 'POST', body });
  } catch (error) {
    closeLinkDialog();
    handleError(error);
    refresh().catch(() => {});
    return;
  }
  if (res.result === 'repeat' || res.result === 'unknown') {
    state.linkTries += 1;
    if (state.linkTries >= 3) voice.say(C.linkTooManyTries);
    else voice.sayThenListen(res.speak);
    return;
  }
  closeLinkDialog();
  focusOn($('page-title'));
  await refresh().catch(() => {});
  voice.say(res.speak);
}

// ---- 觀看模式（畫面同步） ----

function enterObserve({ sessionId, linkId, caregiverName }, page) {
  if (state.observe?.sessionId !== sessionId) {
    form = createParkingForm($('observe-form'), { readOnly: true });
    $('observe-result').hidden = true;
  }
  state.observe = { sessionId, linkId, caregiverName };
  leaveCode();
  $('observe-title').textContent = C.observeTitle(caregiverName);
  $('banner-text').textContent = C.observeTitle(caregiverName);
  $('banner').hidden = false;
  if (state.view !== 'observe') {
    show('observe');
    if (!state.dialog) focusOn($('observe-title'));
  }
  if (page) applyPage(page);
}

function applyPage(page) {
  form.setStep(page.step);
  form.setFields(page.fields);
  $('observe-step').textContent = C.stepLine(page);
}

function exitObserve() {
  state.observe = null;
  $('banner').hidden = true;
  show('home');
  if (!state.dialog) focusOn($('page-title'));
}

async function takeover() {
  if (!state.observe) return;
  const { sessionId } = state.observe;
  exitObserve();
  // 後端會推 session_ended，念「好的，換你自己操作」
  api(`/api/care/sessions/${sessionId}/end`, { method: 'POST' }).catch(handleError);
}

// ---- 同意請求 ----

function acceptLabel() {
  const { consent, consentConfirming } = state;
  const what = consent.action_type === 'pay_parking' ? `繳停車費 ${consent.payload.amount} 元` : '';
  return consentConfirming ? `確認同意${what}` : `同意${what}`;
}

function openConsentDialog(data) {
  if (state.dialog === 'revoke') closeRevoke();
  state.consent = data;
  state.consentConfirming = false;
  state.dialog = 'consent';
  $('dlg-consent-summary').textContent = data.summary;
  $('dlg-consent-code').hidden = !data.voice_code;
  $('dlg-consent-code-value').textContent = data.voice_code ?? '';
  $('dlg-consent-status').textContent = '';
  $('btn-consent-accept').textContent = acceptLabel();
  startCountdown('consent', data.ttl_seconds, (left) => ($('dlg-consent-countdown').textContent = C.consentCountdown(left)), () =>
    ($('dlg-consent-countdown').textContent = C.consentTimeUp),
  );
  openDialog($('dlg-consent'), { background: background() });
  vibrate('consent'); // 和一般步驟不同的震動節奏：長、短、長
  voice.sayThenListen(data.prompt_text, { urgent: true });
}

function closeConsent() {
  stopCountdown('consent');
  state.consent = null;
  state.dialog = null;
  closeDialog($('dlg-consent'), { background: background() });
}

/** body：{ method: 'tap', accept } 或 { method: 'voice', transcript }；同意與否一律由後端判斷 */
async function answerConsent(body) {
  const { consent } = state;
  if (!consent) return;
  if (body.method === 'tap' && body.accept) {
    body.step = consent.level === 'L2' && !state.consentConfirming ? 'first' : 'final';
  }
  let res;
  try {
    res = await api(`/api/consent/requests/${consent.consent_id}/respond`, { method: 'POST', body });
  } catch (error) {
    closeConsent();
    handleError(error);
    return;
  }
  if (res.result === 'confirm_again') {
    // L2 按鈕：念出內容再確認一次，再按一次才成立
    state.consentConfirming = true;
    $('btn-consent-accept').textContent = acceptLabel();
    $('dlg-consent-status').textContent = res.speak;
    focusOn($('btn-consent-accept'));
    voice.say(res.speak);
    return;
  }
  if (res.result === 'repeat' || res.result === 'unknown') {
    $('dlg-consent-status').textContent = res.speak;
    voice.sayThenListen(res.speak);
    return;
  }
  closeConsent();
  voice.say(res.speak);
}

// ---- 終止授權 ----

function revokeTarget() {
  if (state.observe) return state.observe.linkId;
  return state.links.find((link) => link.status === 'active')?.link_id;
}

function askRevoke(linkId) {
  const link = state.links.find((item) => item.link_id === linkId && item.status === 'active');
  if (!link) {
    voice.say(C.noLink);
    return;
  }
  state.revokeLinkId = linkId;
  state.dialog = 'revoke';
  $('dlg-revoke-title').textContent = `確定不讓 ${link.caregiver.name} 幫你操作了嗎？`;
  openDialog($('dlg-revoke'), { background: background() });
  voice.sayThenListen(C.revokeAsk(link.caregiver.name));
}

function closeRevoke() {
  state.revokeLinkId = null;
  state.dialog = null;
  closeDialog($('dlg-revoke'), { background: background() });
}

async function doRevoke() {
  const linkId = state.revokeLinkId;
  closeRevoke();
  try {
    const res = await api(`/api/care/links/${linkId}`, { method: 'DELETE' });
    if (state.observe?.linkId === linkId) exitObserve();
    await refresh();
    voice.say(res.speak);
  } catch (error) {
    handleError(error);
    refresh().catch(() => {});
  }
}

// ---- 語音 ----

function onText(text) {
  if (state.dialog === 'link') return answerLink({ transcript: text });
  if (state.dialog === 'consent') return answerConsent({ method: 'voice', transcript: text });
  if (state.dialog === 'revoke') {
    const command = parseCommand(text, ['confirm', 'cancel', 'repeat']);
    if (command?.type === 'confirm') return doRevoke();
    if (command?.type === 'cancel') {
      closeRevoke();
      return voice.say(C.revokeCancelled);
    }
    return voice.sayThenListen(command?.type === 'repeat' ? voice.lastSpeech : C.notUnderstood.revoke);
  }

  const allowed = {
    home: ['invite', 'revoke', 'repeat'],
    code: ['repeat', 'cancel'],
    observe: ['revoke', 'takeover', 'repeat'],
  }[state.view];
  const command = parseCommand(text, allowed);
  switch (command?.type) {
    case 'invite':
      return showCode();
    case 'cancel':
      return cancelCode();
    case 'takeover':
      return takeover();
    case 'revoke':
      return askRevoke(revokeTarget());
    case 'repeat':
      return voice.sayThenListen(state.view === 'code' ? state.codeSpeak : voice.lastSpeech || C.elderIntro);
    default:
      return voice.sayThenListen(C.notUnderstood[state.view]);
  }
}

function onVoiceError(error, { auto }) {
  if (error.code === 'no_speech') {
    if (!auto) voice.say(C.noSpeech);
    return;
  }
  voice.say(error.code === 'permission' ? S.micPermission : S.micUnavailable);
}

// ---- 後端推送的事件 ----

const handlers = {
  link_confirm_requested: (data) => openLinkDialog(data),

  async link_closed(data) {
    if (state.pendingLink?.link_id === data.link_id) closeLinkDialog();
    if (state.revokeLinkId === data.link_id) closeRevoke();
    if (state.observe?.linkId === data.link_id) exitObserve();
    await refresh().catch(() => {});
    if (data.speak) voice.say(data.speak);
  },

  session_started(data) {
    enterObserve({ sessionId: data.session_id, linkId: data.link_id, caregiverName: data.caregiver_name });
    vibrate('step');
    if (!state.dialog) voice.say(data.speak);
  },

  page_sync(data) {
    if (state.observe?.sessionId !== data.session_id) {
      refresh().catch(() => {});
      return;
    }
    applyPage(data);
    if (data.speak) {
      vibrate('step');
      if (!state.dialog) voice.say(data.speak);
    }
  },

  session_ended(data) {
    if (state.observe?.sessionId === data.session_id) exitObserve();
    if (!state.dialog) voice.say(data.speak);
  },

  consent_requested: (data) => openConsentDialog(data),

  consent_cancelled(data) {
    if (state.consent?.consent_id !== data.consent_id) return;
    closeConsent();
    voice.say(data.speak);
  },

  action_completed(data) {
    vibrate('done');
    $('observe-result').textContent = `${data.speak}（收據編號 ${data.receipt_id}，模擬）`;
    $('observe-result').hidden = false;
    voice.say(data.speak);
  },
};

// ---- 開始 ----

function bindActions() {
  const actions = {
    invite: () => showCode(),
    'repeat-code': () => voice.sayThenListen(state.codeSpeak),
    'cancel-code': cancelCode,
    'link-accept': () => answerLink({ accept: true }),
    'link-reject': () => answerLink({ accept: false }),
    'consent-accept': () => answerConsent({ method: 'tap', accept: true }),
    'consent-reject': () => answerConsent({ method: 'tap', accept: false }),
    revoke: () => askRevoke(revokeTarget()),
    'revoke-confirm': doRevoke,
    'revoke-cancel': () => {
      closeRevoke();
      voice.say(C.revokeCancelled);
    },
    takeover,
    async logout() {
      voice.interrupt();
      await api('/api/auth/logout', { method: 'POST' }).catch(() => {});
      clearLogin();
      location.replace('index.html');
    },
  };
  document.addEventListener('click', (event) => {
    const button = event.target.closest('[data-action]');
    if (button) actions[button.dataset.action]?.();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) voice.interrupt();
  });
}

function init() {
  if (!requireLogin()) return;
  $('me').textContent = getUser()?.name ?? '';
  voice = createVoice({
    button: $('btn-talk'),
    label: $('talk-label'),
    partial: $('talk-partial'),
    idleText: C.talkIdle,
    listeningText: C.talkListening,
    hintText: C.talkStopHint,
    onText,
    onError: onVoiceError,
  });
  setupMockMic({ form: $('mock-mic'), input: $('mock-input'), cancel: $('mock-cancel') });
  bindActions();
  connectEvents({
    token: getToken(),
    onEvent: (type, data) => handlers[type]?.(data),
    onOpen: () => refresh().catch(handleError),
    onStatus: (connected) => ($('conn').hidden = connected),
  });
  focusOn($('page-title'));
  voice.say(C.elderIntro);
}

init();
