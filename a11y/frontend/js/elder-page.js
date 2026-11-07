// 功能 B：被照顧者（例如王阿伯）的頁面。
//
// - 產生 6 位數字碼（5 分鐘換一組）並念出來
// - 家人輸入後，問「王小美 想看你的畫面、幫你操作，同意嗎？」
// - 同意後開始分享：之後在台北通打開的服務網頁，家人都看得到，也能幫忙點按、填寫
//   （分享程式由 App 放進服務網頁，見 share-script.js、share-agent.js）
// - 隨時可以說「停止分享」，或按「停止分享」
// 看得到畫面的人用按鈕；看不到的人全程用語音。

import { closeDialog, focusOn, openDialog, vibrate } from './a11y.js';
import { api, clearLogin, getToken, getUser, requireLogin } from './api.js';
import { inApp, openInApp } from './bridge.js';
import { startSharing, stopSharing } from './share-script.js';
import { C, S } from './strings.js';
import { parseCommand } from './voice-commands.js';
import { createVoice, setupMockMic } from './voice-session.js';
import { connectEvents } from './ws.js';

const $ = (id) => document.getElementById(id);
const background = () => [$('main')];

// 台北通「城市服務」裡的網頁服務（網址取自 TownPass 的 my_service_model.dart）。
// 電腦測試時只能開模擬服務頁：真的服務網頁要在台北通裡，App 才會放入分享程式。
const SERVICES = [
  { title: '申辦服務', url: 'https://taipei-pass-service.vercel.app/', app: true },
  { title: '有話要說', url: 'https://taipei-pass-service.vercel.app/citizen-report/', app: true },
  { title: '臨櫃叫號', url: 'https://taipei-pass-service.vercel.app/counter-calling/', app: true },
  { title: '市政資訊儀表板', url: 'https://dashboard.gov.taipei/', app: true },
  { title: '模擬服務頁（測試用）', url: 'demo/service.html' },
];

const state = {
  view: 'home',       // home / code / sharing
  dialog: null,       // link / revoke
  links: [],
  pendingLink: null,  // 等待同意的授權 { link_id, caregiver_name }
  linkTries: 0,
  sharing: null,      // { linkId, caregiverName, mode }
  revokeLinkId: null,
  codeSpeak: '',
  timers: {},
};

let voice;

// ---- 共用 ----

function show(view) {
  for (const name of ['home', 'code', 'sharing']) $(`view-${name}`).hidden = name !== view;
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

  if (!state.dialog) {
    const pending = links.find((link) => link.status === 'pending');
    if (pending) openLinkDialog({ link_id: pending.link_id, caregiver_name: pending.caregiver.name });
  }

  const active = links.find((link) => link.status === 'active');
  if (active) await enterSharing(active);
  else if (state.view === 'sharing') leaveSharing();
}

// ---- 數字碼 ----

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

// ---- 同意讓家人看畫面 ----

function openLinkDialog(data) {
  leaveCode(); // 數字碼已經被用掉了
  state.pendingLink = data;
  state.linkTries = 0;
  state.dialog = 'link';
  $('dlg-link-title').textContent = C.linkTitle(data.caregiver_name);
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
  if (res.result === 'accept') await enterSharing(res.link).catch(handleError);
  else focusOn($('page-title'));
  voice.say(res.speak);
}

// ---- 分享畫面 ----

async function enterSharing(link) {
  const isNew = state.sharing?.linkId !== link.link_id;
  if (isNew) {
    const share = await api('/api/share/start', { method: 'POST', body: { link_id: link.link_id } });
    // 每次打開這一頁都再交給 App 一次：App 重開後也能恢復分享
    const mode = await startSharing(share);
    state.sharing = { linkId: link.link_id, caregiverName: link.caregiver.name, mode };
  }
  leaveCode();
  renderSharing();
  if (state.view !== 'sharing') {
    show('sharing');
    if (!state.dialog) focusOn($('sharing-title'));
  }
}

function renderSharing() {
  const { caregiverName, mode } = state.sharing;
  $('sharing-title').textContent = C.sharingTitle(caregiverName);
  $('sharing-desc').textContent = C.sharingDesc(caregiverName);
  $('sharing-warning').hidden = mode !== 'unsupported';
  $('sharing-warning').textContent = mode === 'unsupported' ? C.sharingUnsupported : '';

  const services = SERVICES.filter((service) => (inApp ? true : !service.app));
  $('service-list').replaceChildren(
    ...services.map((service) => {
      const item = document.createElement('li');
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'btn btn-secondary';
      button.textContent = service.title;
      button.addEventListener('click', () => openService(service));
      item.append(button);
      return item;
    }),
  );
}

function openService(service) {
  voice.interrupt();
  // 模擬服務頁和這一頁在同一個網站：在 App 裡也要用完整網址開新的網頁畫面
  openInApp(new URL(service.url, location.href).href);
}

function leaveSharing() {
  state.sharing = null;
  stopSharing();
  show('home');
  if (!state.dialog) focusOn($('page-title'));
}

// ---- 停止分享 ----

function askRevoke() {
  const link = state.links.find((item) => item.status === 'active');
  if (!link) {
    voice.say(C.noLink);
    return;
  }
  state.revokeLinkId = link.link_id;
  state.dialog = 'revoke';
  $('dlg-revoke-title').textContent = C.revokeTitle(link.caregiver.name);
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
    leaveSharing();
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
    home: ['invite', 'repeat'],
    code: ['repeat', 'cancel'],
    sharing: ['revoke', 'repeat'],
  }[state.view];
  const command = parseCommand(text, allowed);
  switch (command?.type) {
    case 'invite':
      return showCode();
    case 'cancel':
      return cancelCode();
    case 'revoke':
      return askRevoke();
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
    if (state.sharing?.linkId === data.link_id) leaveSharing();
    await refresh().catch(() => {});
    if (data.speak) voice.say(data.speak);
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
    revoke: askRevoke,
    'revoke-confirm': doRevoke,
    'revoke-cancel': () => {
      closeRevoke();
      voice.say(C.revokeCancelled);
    },
    async logout() {
      voice.interrupt();
      stopSharing();
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
