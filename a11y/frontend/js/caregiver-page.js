// 功能 B：照顧者（例如王小美）的頁面。
//
// - 輸入家人手機上的 6 位數字碼
// - 家人同意後，看到家人台北通的所有畫面（App 每秒檢查一次，畫面有變化就送來）
//   點畫面上的位置 → 家人的手機在同一個位置按一下；先點欄位，再按「幫忙打字」填寫
// - 電腦測試的模擬服務頁：rrweb 重播網頁，點輸入框就能直接填寫
// - 送出、付款這類重要按鈕，家人的手機會先問他同不同意；密碼欄位不能填
// 照顧者看得到畫面，這一頁不朗讀，避免兩支手機同時出聲；訊息顯示在畫面上，螢幕閱讀器也會念。

import { closeDialog, focusOn, openDialog } from './a11y.js';
import { api, clearLogin, getToken, getUser, requireLogin } from './api.js';
import { C } from './strings.js';
import { connectEvents } from './ws.js';

const $ = (id) => document.getElementById(id);
const RRWEB_META = 4;
const ACTIONABLE = 'a,button,input,select,textarea,label,summary,[role="button"],[role="link"],[role="checkbox"],[role="radio"],[role="tab"],[contenteditable]';

const state = {
  links: [],
  watching: null,   // { linkId, elderName }
  mode: null,       // 'screen'（台北通 App 的畫面）或 'web'（模擬服務頁）
  frame: null,      // 台北通 App 畫面的大小 { width, height }
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
  // 看畫面時收起頁首，對方的手機畫面才放得大
  document.body.classList.toggle('watching', view === 'watch');
}

// ---- 授權 ----

async function refresh() {
  const { links } = await api('/api/care/links');
  state.links = links;
  $('links-empty').hidden = links.length > 0;
  $('links-list').replaceChildren(
    ...links.map((link) => {
      const pending = link.status === 'pending';
      const item = document.createElement('li');
      item.className = 'person';
      const head = document.createElement('div');
      head.className = 'person-head';
      const avatar = Object.assign(document.createElement('span'), { className: 'avatar', textContent: link.elder.name.slice(-2) });
      avatar.setAttribute('aria-hidden', 'true');
      const text = document.createElement('p');
      const name = Object.assign(document.createElement('strong'), { textContent: link.elder.name });
      const detail = Object.assign(document.createElement('span'), {
        className: 'muted small',
        textContent: pending ? `等待 ${link.elder.name} 同意…` : `${link.elder.name} 已同意讓你看他的畫面`,
      });
      text.append(name, detail);
      const chip = Object.assign(document.createElement('span'), {
        className: pending ? 'chip warn' : 'chip ok',
        textContent: pending ? '等待同意' : '可以看畫面',
      });
      head.append(avatar, text, chip);
      item.append(head);
      if (pending) return item;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'btn btn-primary';
      button.textContent = `看 ${link.elder.name} 的畫面`;
      button.addEventListener('click', () => startWatching(link));
      item.append(button);
      return item;
    }),
  );
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

// ---- 看對方的畫面 ----

async function startWatching(link) {
  const elder = link.elder.name;
  state.watching = { linkId: link.link_id, elderName: elder };
  $('watch-title').textContent = `${elder} 的畫面`;
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
    if (res.page && res.frame) showFrame(res.frame);
    else if (res.page && res.events.length) rebuild(res.events);
  } catch (error) {
    handleError(error);
  }
}

function leaveWatching() {
  clearStage();
  closeInput();
  state.watching = null;
  show('home');
  focusOn($('page-title'));
  refresh().catch(() => {});
}

function setPage(page, message) {
  $('watch-page').textContent = page ? `正在看：${page.title || page.url}` : '';
  if (!page) clearStage();
  if (!state.mode) {
    $('stage-empty').textContent = page ? '正在載入畫面…' : message ?? `還看不到 ${state.watching?.elderName ?? '對方'} 的畫面。`;
    $('stage-empty').hidden = false;
  }
}

function setMode(mode) {
  state.mode = mode;
  const elder = state.watching?.elderName ?? '對方';
  $('phone-bar').hidden = !mode;
  $('btn-type').hidden = mode !== 'screen';
  $('btn-home').hidden = mode !== 'screen';
  $('watch-hint').textContent = mode === 'screen'
    ? `框框裡就是 ${elder} 的手機：點哪裡，他的手機就在同一個位置按一下；在畫面上拖曳或滾動滑鼠滾輪可以捲動。點到要填寫的欄位，框框下方會出現打字框。送出、付款這類按鈕會先問 ${elder}，密碼請他自己輸入。`
    : mode === 'web'
      ? `點畫面上的按鈕，就會在 ${elder} 的手機上按；點輸入框可以幫他填寫。送出、付款這類按鈕會先問 ${elder}，密碼請他自己輸入。`
      : '';
}

function clearStage() {
  destroyReplayer();
  hideScreen();
  setMode(null);
}

/**
 * 對方的畫面可以放多大：看畫面時整個螢幕扣掉上方標題、訊息與下方按鈕列，剩下的就是 stage-view（care.css）。
 * 畫面等比例縮到這裡面，一次看得完（家人也是用手機看，不能讓頁面捲動，拖曳要留給捲動對方的手機）。
 */
function stageBox() {
  const view = $('stage-view');
  const style = getComputedStyle(view);
  const padX = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
  const padY = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
  return { width: view.clientWidth - padX - 2, height: view.clientHeight - padY - 2 }; // 2 = 外框線
}

// ---- 台北通 App 的畫面 ----

function showFrame(frame) {
  if (state.mode !== 'screen') {
    destroyReplayer();
    setMode('screen');
  }
  state.frame = { width: frame.width, height: frame.height };
  $('watch-page').textContent = `正在看：${frame.title || '台北通'}`;
  $('screen-base').src = frame.image;
  $('screen-base').alt = `${state.watching?.elderName ?? '對方'} 的台北通畫面：${frame.title || '台北通'}`;
  const holder = $('screen-overlays');
  const pct = (value, total) => `${(value / total) * 100}%`;
  frame.overlays.forEach((overlay, index) => {
    // 重用同一個 img，換圖時才不會閃
    const img = holder.children[index] ?? holder.appendChild(Object.assign(document.createElement('img'), { alt: '', draggable: false }));
    img.style.left = pct(overlay.x, frame.width);
    img.style.top = pct(overlay.y, frame.height);
    img.style.width = pct(overlay.width, frame.width);
    if (img.getAttribute('src') !== overlay.image) img.src = overlay.image;
  });
  while (holder.children.length > frame.overlays.length) holder.lastChild.remove();
  $('stage-empty').hidden = true;
  $('screen').hidden = false;
  fitScreen();
}

/** 整個手機畫面縮到一次看得完：寬、高都不超過 stage-view */
function fitScreen() {
  if (!state.frame) return;
  const box = stageBox();
  if (box.width <= 0 || box.height <= 0) return;
  const ratio = state.frame.width / state.frame.height;
  const width = Math.min(box.width, box.height * ratio);
  $('screen').style.width = `${Math.floor(width)}px`;
}

function hideScreen() {
  state.frame = null;
  $('screen').hidden = true;
  $('screen-base').removeAttribute('src');
  $('screen-overlays').replaceChildren();
  $('screen-tap').hidden = true;
}

let tapMarkTimer = 0;

// 在畫面上拖曳（手指或滑鼠）或滾動滑鼠滾輪 → 對方的手機跟著捲；沒有拖曳就是點按
let drag = null;

function onScreenPointerDown(event) {
  if (state.mode !== 'screen' || !state.frame || event.button > 0) return;
  drag = { id: event.pointerId, x: event.clientX, y: event.clientY, moved: false };
  $('screen').setPointerCapture?.(event.pointerId);
}

function onScreenPointerMove(event) {
  if (!drag || event.pointerId !== drag.id) return;
  if (Math.abs(event.clientX - drag.x) > 10 || Math.abs(event.clientY - drag.y) > 10) drag.moved = true;
}

function onScreenPointerUp(event) {
  if (!drag || event.pointerId !== drag.id) return;
  const start = drag;
  drag = null;
  if (!start.moved) {
    onScreenTap(event);
    return;
  }
  const rect = $('screen').getBoundingClientRect();
  // 手指往上拖 = 內容往下捲
  queueScroll(-((event.clientY - start.y) / rect.height) * state.frame.height, true);
}

function onScreenWheel(event) {
  if (state.mode !== 'screen' || !state.frame) return;
  event.preventDefault();
  const rect = $('screen').getBoundingClientRect();
  const lines = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? rect.height : 1;
  queueScroll(((event.deltaY * lines) / rect.height) * state.frame.height);
}

// 滾輪會連續送來很多小段，累積起來每 300 毫秒送一次
let pendingScroll = 0;
let scrollTimer = 0;

function queueScroll(dy, now = false) {
  pendingScroll += dy;
  if (now) {
    flushScroll();
    return;
  }
  scrollTimer ||= setTimeout(flushScroll, 300);
}

function flushScroll() {
  clearTimeout(scrollTimer);
  scrollTimer = 0;
  const dy = Math.max(-5000, Math.min(5000, Math.round(pendingScroll)));
  pendingScroll = 0;
  if (Math.abs(dy) >= 20) sendCommand({ action: 'scroll', dy }, '');
}

function onScreenTap(event) {
  if (state.mode !== 'screen' || !state.frame) return;
  const rect = $('screen').getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  const x = ((event.clientX - rect.left) / rect.width) * state.frame.width;
  const y = ((event.clientY - rect.top) / rect.height) * state.frame.height;
  if (x < 0 || y < 0 || x > state.frame.width || y > state.frame.height) return;
  const mark = $('screen-tap');
  mark.style.left = `${event.clientX - rect.left}px`;
  mark.style.top = `${event.clientY - rect.top}px`;
  mark.hidden = false;
  clearTimeout(tapMarkTimer);
  tapMarkTimer = setTimeout(() => (mark.hidden = true), 1200);
  sendCommand({ action: 'tap', x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10 }, '已請對方的手機按這裡…');
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
  hideScreen();
  setMode('web');
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
  const box = stageBox();
  if (box.width <= 0 || box.height <= 0) return;
  const scale = Math.min(1, box.width / width, box.height / height);
  state.replayScale = scale;
  replayer.wrapper.style.transformOrigin = '0 0';
  replayer.wrapper.style.transform = `scale(${scale})`;
  $('replay').style.width = `${Math.floor(width * scale)}px`;
  $('replay').style.height = `${Math.floor(height * scale)}px`;
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
  // 滾輪 → 對方的手機跟著捲（重播畫面縮小過，換算回對方手機的大小）
  doc.addEventListener(
    'wheel',
    (event) => {
      event.preventDefault();
      const lines = event.deltaMode === 1 ? 16 : 1;
      queueScroll(event.deltaY * lines);
    },
    { passive: false, capture: true },
  );
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

// ---- 幫忙填寫 ----

// 打字框在框框裡（像手機鍵盤）；打開時框框的畫面和按鈕列先不能按
const typingBackground = () => [$('screen'), $('replay'), $('phone-bar')];

/** 台北通 App：填入對方手機上選取的欄位。點到欄位時自動打開；也可以按按鈕列的「打字」 */
function openTypeDialog(name = '') {
  if (state.mode !== 'screen') return;
  state.input = { type: true, name };
  $('dlg-input-title').textContent = name ? C.inputTitle(name) : C.typeTitle;
  showInputFields(false);
  $('input-text').value = '';
  openDialog($('dlg-input'), { background: typingBackground() });
  $('input-text').focus();
}

function showInputFields(isSelect) {
  $('input-text').hidden = isSelect;
  $('input-text-label').hidden = isSelect;
  $('input-select').hidden = !isSelect;
  $('input-select-label').hidden = !isSelect;
}

function openInput(el, nodeId) {
  if (el.tagName === 'INPUT' && el.type === 'password') {
    notify(C.passwordBlocked(state.watching.elderName));
    return;
  }
  const name = fieldName(el);
  state.input = { nodeId, name };
  $('dlg-input-title').textContent = C.inputTitle(name);
  const isSelect = el.tagName === 'SELECT';
  showInputFields(isSelect);
  if (isSelect) {
    $('input-select').replaceChildren(
      ...[...el.options].map((option) => new Option(option.textContent.trim() || option.value, option.value, false, option.selected)),
    );
  } else {
    $('input-text').value = el.isContentEditable ? el.textContent : el.value ?? '';
  }
  openDialog($('dlg-input'), { background: typingBackground() });
  (isSelect ? $('input-select') : $('input-text')).focus();
}

function closeInput() {
  if (!state.input) return;
  state.input = null;
  closeDialog($('dlg-input'), { background: typingBackground() });
}

function submitInput() {
  const input = state.input;
  if (!input) return;
  const value = $('input-select').hidden ? $('input-text').value : $('input-select').value;
  closeInput();
  if (input.type) sendCommand({ action: 'type', value }, C.sendingType);
  else sendCommand({ action: 'input', node_id: input.nodeId, value }, C.sendingInput(input.name));
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
  share_frame(data) {
    if (isWatching(data)) showFrame(data.frame);
  },
  share_result(data) {
    if (!isWatching(data) || !data.message) return;
    notify(data.message);
    // App 點到欄位時回「已點「姓名」…」（a11y_share_service.dart 的 _tapWeb）：直接打開打字框
    const field = /^已點「(.+?)」/.exec(data.message);
    if (field && !state.input) openTypeDialog(field[1]);
  },
};

// ---- 開始 ----

function init() {
  if (!requireLogin()) return;
  $('me').textContent = getUser()?.name ?? '';
  $('me-avatar').textContent = (getUser()?.name ?? '').slice(-2);

  $('code-form').addEventListener('submit', (event) => {
    event.preventDefault();
    submitCode($('code-input').value.trim());
  });
  $('input-form').addEventListener('submit', (event) => {
    event.preventDefault();
    submitInput();
  });
  const actions = {
    leave: leaveWatching,
    'go-back': () => sendCommand({ action: 'back' }, '已請對方的手機回到上一頁…'),
    'input-cancel': closeInput,
    'type-text': () => openTypeDialog(),
    'go-home': () => sendCommand({ action: 'home' }, '已請對方的手機回到台北通首頁…'),
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
  // 畫面區變大變小（轉向、訊息出現、打字框打開）就重新縮放
  const refit = () => {
    fit();
    fitScreen();
  };
  window.addEventListener('resize', refit);
  if ('ResizeObserver' in window) new ResizeObserver(refit).observe($('stage-view'));
  $('screen').addEventListener('pointerdown', onScreenPointerDown);
  $('screen').addEventListener('pointermove', onScreenPointerMove);
  $('screen').addEventListener('pointerup', onScreenPointerUp);
  $('screen').addEventListener('pointercancel', () => (drag = null));
  $('screen').addEventListener('wheel', onScreenWheel, { passive: false });

  connectEvents({
    token: getToken(),
    onEvent: (type, data) => handlers[type]?.(data),
    onOpen: () => {
      refresh().catch(handleError);
      loadShare(); // 斷線期間錯過的畫面變化，重新拿一次完整畫面
    },
    onStatus: (connected) => ($('conn').hidden = connected),
  });

  focusOn($('page-title'));
}

init();
