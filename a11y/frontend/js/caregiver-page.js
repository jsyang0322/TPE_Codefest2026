// 功能 B：照顧者（例如王小美）的頁面。
//
// - 輸入家人的 6 位數字碼，或用台北通掃描 QR code（QR code 是這一頁的網址，帶 ?code=）
// - 家人同意後，看到家人在台北通打開的服務畫面（rrweb 重播，畫面一有變化就同步）
// - 點畫面上的按鈕 → 家人的手機按下同一個按鈕；點輸入框 → 填好內容後送到家人的手機
//   送出、付款這類重要按鈕，家人的手機會先問他同不同意；密碼欄位不能填
// 照顧者看得到畫面，這一頁不朗讀，避免兩支手機同時出聲；訊息顯示在畫面上，螢幕閱讀器也會念。

import { closeDialog, focusOn, openDialog } from './a11y.js';
import { api, clearLogin, getToken, getUser, requireLogin } from './api.js';
import * as bridge from './bridge.js';
import { C } from './strings.js';
import { connectEvents } from './ws.js';

const $ = (id) => document.getElementById(id);
const RRWEB_META = 4;
const ACTIONABLE = 'a,button,input,select,textarea,label,summary,[role="button"],[role="link"],[role="checkbox"],[role="radio"],[role="tab"],[contenteditable]';

const state = {
  links: [],
  watching: null,   // { linkId, elderName }
  replayer: null,
  size: { width: 390, height: 844 },
  lastStamp: 0,
  input: null,      // 正在填寫的欄位 { nodeId, name }
};

function notify(text) {
  $('status').textContent = text ?? '';
}

function handleError(error) {
  if (error?.status === 401) {
    location.replace('index.html');
    return;
  }
  notify(error?.message ?? '發生錯誤，請再試一次。');
}

function show(view) {
  $('view-home').hidden = view !== 'home';
  $('view-watch').hidden = view !== 'watch';
}

// ---- 授權 ----

async function refresh() {
  const { links } = await api('/api/care/links');
  state.links = links;
  $('links-empty').hidden = links.length > 0;
  $('links-list').replaceChildren(
    ...links.map((link) => {
      const item = document.createElement('li');
      const text = document.createElement('p');
      if (link.status === 'pending') {
        text.textContent = `等待 ${link.elder.name} 同意…`;
        item.append(text);
        return item;
      }
      text.textContent = `${link.elder.name} 已同意讓你看他的畫面`;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'btn btn-primary';
      button.textContent = `看 ${link.elder.name} 的畫面`;
      button.addEventListener('click', () => startWatching(link));
      item.append(text, button);
      return item;
    }),
  );
}

/** QR code 內容是 caregiver.html?code=123456；也接受只有 6 位數字 */
function codeFrom(text) {
  try {
    const code = new URL(text).searchParams.get('code');
    if (/^\d{6}$/.test(code ?? '')) return code;
  } catch {
    // 不是網址
  }
  return String(text).match(/\b(\d{6})\b/)?.[1] ?? null;
}

async function submitCode(code) {
  if (!/^\d{6}$/.test(code)) {
    notify(C.badCode);
    return;
  }
  try {
    await api('/api/care/links', { method: 'POST', body: { code } });
    $('code-input').value = '';
    notify(C.waitingElder);
    await refresh();
  } catch (error) {
    handleError(error);
  }
}

async function scan() {
  const text = await bridge.scanQrCode();
  if (!text) return;
  const code = codeFrom(text);
  if (code) submitCode(code);
  else notify(C.notBindQr);
}

// ---- 看對方的畫面 ----

async function startWatching(link) {
  const elder = link.elder.name;
  state.watching = { linkId: link.link_id, elderName: elder };
  $('watch-title').textContent = `${elder} 的畫面`;
  $('watch-hint').textContent =
    `點畫面上的按鈕，就會在 ${elder} 的手機上按；點輸入框可以幫他填寫。送出、付款這類按鈕會先問 ${elder}，密碼請他自己輸入。`;
  notify('');
  show('watch');
  focusOn($('watch-title'));
  await loadShare();
}

async function loadShare() {
  if (!state.watching) return;
  try {
    const res = await api(`/api/share/${state.watching.linkId}`);
    setPage(res.page, res.message);
    if (res.page && res.events.length) rebuild(res.events);
  } catch (error) {
    handleError(error);
  }
}

function leaveWatching() {
  destroyReplayer();
  closeInput();
  state.watching = null;
  show('home');
  focusOn($('page-title'));
  refresh().catch(() => {});
}

function setPage(page, message) {
  $('watch-page').textContent = page ? `正在看：${page.title || page.url}` : '';
  if (!page) destroyReplayer();
  if (!state.replayer) {
    $('stage-empty').textContent = page ? '正在載入畫面…' : message ?? `${state.watching?.elderName ?? '對方'} 現在沒有打開網頁服務。`;
    $('stage-empty').hidden = false;
  }
}

// rrweb 用事件的時間決定什麼時候播放。兩支手機的時鐘不一定一樣，所以收到時改成這支手機的時間，收到就播
function stamp(events) {
  for (const event of events) {
    state.lastStamp = Math.max(Date.now(), state.lastStamp + 1);
    event.timestamp = state.lastStamp;
  }
  return events;
}

function rebuild(events) {
  destroyReplayer();
  const meta = events.findIndex((event) => event.type === RRWEB_META);
  if (meta < 0) return; // 要從完整畫面開始，等手機重送
  const list = stamp(events.slice(meta));
  const { Replayer } = window.rrwebReplay;
  const replayer = new Replayer([], {
    root: $('replay'),
    liveMode: true,
    mouseTail: false,
    showWarning: false,
    triggerFocus: false,
    UNSAFE_replayCanvas: false,
  });
  replayer.on('resize', (size) => {
    state.size = size;
    fit();
  });
  replayer.on('fullsnapshot-rebuilded', attachTap);
  replayer.startLive(list[0].timestamp);
  for (const event of list) replayer.addEvent(event);
  replayer.enableInteract();
  state.replayer = replayer;
  $('stage-empty').hidden = true;
  $('replay').hidden = false;
  fit();
}

function addEvents(events) {
  if (!events.length) return;
  if (events.some((event) => event.type === RRWEB_META)) {
    rebuild(events);
    return;
  }
  if (!state.replayer) return;
  for (const event of stamp(events)) state.replayer.addEvent(event);
}

function destroyReplayer() {
  if (state.replayer) {
    try {
      state.replayer.destroy();
    } catch {
      // 已經清掉了
    }
  }
  state.replayer = null;
  $('replay').replaceChildren();
  $('replay').hidden = true;
}

/** 對方手機的畫面依這支手機的寬度等比例縮小 */
function fit() {
  const replayer = state.replayer;
  if (!replayer?.wrapper) return;
  const { width, height } = state.size;
  const scale = Math.min(1, $('stage').clientWidth / width);
  replayer.wrapper.style.transformOrigin = '0 0';
  replayer.wrapper.style.transform = `scale(${scale})`;
  $('replay').style.height = `${Math.ceil(height * scale)}px`;
}

// ---- 點畫面 → 對方的手機執行 ----

const tapped = new WeakSet();

function attachTap() {
  const doc = state.replayer?.iframe?.contentDocument;
  if (!doc || tapped.has(doc)) return;
  tapped.add(doc);
  doc.addEventListener('click', onTap, true);
  // 重播的畫面只用來看和點：不讓它自己換頁、送出表單或跳出鍵盤
  doc.addEventListener('submit', (event) => event.preventDefault(), true);
  doc.addEventListener('mousedown', (event) => event.preventDefault(), true);
  doc.addEventListener('focusin', (event) => event.target?.blur?.(), true);
}

function mirrorId(node) {
  const mirror = state.replayer.getMirror();
  for (let current = node; current; current = current.parentNode) {
    const id = mirror.getId(current);
    if (id > 0) return id;
  }
  return -1;
}

function clean(text, limit) {
  const value = String(text ?? '').replace(/\s+/g, ' ').trim();
  return value.length > limit ? `${value.slice(0, limit)}…` : value;
}

function labelOf(el) {
  const type = (el.getAttribute('type') ?? '').toLowerCase();
  const text = el.tagName === 'INPUT' && /^(button|submit|reset)$/.test(type) ? el.value : '';
  return clean(text || el.getAttribute('aria-label') || el.textContent || el.getAttribute('title'), 20) || '這個按鈕';
}

function fieldName(el) {
  const doc = el.ownerDocument;
  let text = '';
  if (el.id) text = doc.querySelector(`label[for="${CSS.escape(el.id)}"]`)?.textContent ?? '';
  text ||= el.closest('label')?.textContent ?? '';
  text ||= el.getAttribute('aria-label') || el.getAttribute('placeholder') || el.getAttribute('name') || '';
  return clean(text, 16) || '這個欄位';
}

function isField(el) {
  if (el.isContentEditable || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT') return true;
  return el.tagName === 'INPUT' && !/^(button|submit|reset|checkbox|radio|file|image|hidden|range|color)$/i.test(el.type);
}

function onTap(event) {
  event.preventDefault();
  event.stopPropagation();
  if (!state.replayer || !state.watching) return;
  const target = event.target.nodeType === Node.ELEMENT_NODE ? event.target : event.target.parentElement;
  if (!target) return;
  const el = target.closest(ACTIONABLE) ?? target;
  const nodeId = mirrorId(el);
  if (nodeId < 1) return;
  if (isField(el)) {
    openInput(el, nodeId);
    return;
  }
  sendCommand({ action: 'click', node_id: nodeId }, C.sending(labelOf(el)));
}

async function sendCommand(body, pendingText) {
  if (!state.watching) return;
  if (pendingText) notify(pendingText);
  try {
    await api(`/api/share/${state.watching.linkId}/commands`, { method: 'POST', body });
  } catch (error) {
    handleError(error);
  }
}

function scrollBy(direction) {
  const dy = Math.round(state.size.height * 0.6) * direction;
  sendCommand({ action: 'scroll', dy }, '');
}

// ---- 幫忙填寫 ----

function openInput(el, nodeId) {
  if (el.tagName === 'INPUT' && el.type === 'password') {
    notify(C.passwordBlocked(state.watching.elderName));
    return;
  }
  const name = fieldName(el);
  state.input = { nodeId, name };
  $('dlg-input-title').textContent = C.inputTitle(name);
  const isSelect = el.tagName === 'SELECT';
  $('input-text').hidden = isSelect;
  $('input-text-label').hidden = isSelect;
  $('input-select').hidden = !isSelect;
  $('input-select-label').hidden = !isSelect;
  if (isSelect) {
    $('input-select').replaceChildren(
      ...[...el.options].map((option) => new Option(option.textContent.trim() || option.value, option.value, false, option.selected)),
    );
  } else {
    $('input-text').value = el.isContentEditable ? el.textContent : el.value ?? '';
  }
  openDialog($('dlg-input'), { background: [$('main')] });
  (isSelect ? $('input-select') : $('input-text')).focus();
}

function closeInput() {
  if (!state.input) return;
  state.input = null;
  closeDialog($('dlg-input'), { background: [$('main')] });
}

function submitInput() {
  const input = state.input;
  if (!input) return;
  const value = $('input-select').hidden ? $('input-text').value : $('input-select').value;
  closeInput();
  sendCommand({ action: 'input', node_id: input.nodeId, value }, C.sendingInput(input.name));
}

// ---- 後端推送的事件 ----

const isWatching = (data) => state.watching?.linkId === data.link_id;

const handlers = {
  async link_activated(data) {
    await refresh().catch(() => {});
    notify(data.speak);
  },
  async link_closed(data) {
    if (isWatching(data)) leaveWatching();
    else await refresh().catch(() => {});
    notify(data.speak);
  },
  share_page(data) {
    if (isWatching(data)) setPage(data.page, data.message);
  },
  share_events(data) {
    if (isWatching(data)) addEvents(data.events);
  },
  share_result(data) {
    if (isWatching(data) && data.message) notify(data.message);
  },
};

// ---- 開始 ----

function init() {
  if (!requireLogin()) return;
  $('me').textContent = getUser()?.name ?? '';
  $('btn-scan').hidden = !bridge.inApp; // 掃描用台北通 App 內建的相機，一般瀏覽器沒有

  $('code-form').addEventListener('submit', (event) => {
    event.preventDefault();
    submitCode($('code-input').value.trim());
  });
  $('input-form').addEventListener('submit', (event) => {
    event.preventDefault();
    submitInput();
  });
  const actions = {
    scan,
    leave: leaveWatching,
    'scroll-up': () => scrollBy(-1),
    'scroll-down': () => scrollBy(1),
    'go-back': () => sendCommand({ action: 'back' }, '已請對方的手機回到上一頁…'),
    'input-cancel': closeInput,
    async logout() {
      await api('/api/auth/logout', { method: 'POST' }).catch(() => {});
      clearLogin();
      location.replace('index.html');
    },
  };
  document.addEventListener('click', (event) => {
    const button = event.target.closest('[data-action]');
    if (button) actions[button.dataset.action]?.();
  });
  window.addEventListener('resize', fit);

  connectEvents({
    token: getToken(),
    onEvent: (type, data) => handlers[type]?.(data),
    onOpen: () => {
      refresh().catch(handleError);
      loadShare(); // 斷線期間錯過的畫面變化，重新拿一次完整畫面
    },
    onStatus: (connected) => ($('conn').hidden = connected),
  });

  // 從 QR code 打開（caregiver.html?code=123456）：直接送出
  const code = new URLSearchParams(location.search).get('code');
  if (code) {
    history.replaceState(null, '', location.pathname);
    submitCode(code);
  }
  focusOn($('page-title'));
}

init();
