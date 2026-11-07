// 功能 B：照顧者（例如王小美）的頁面。
//
// - 輸入家人的 6 位數字碼，或用台北通掃描 QR code（QR code 是這一頁的網址，帶 ?code=）
// - 家人同意後開始代操作：每做一步送一則小事件給後端，後端轉給家人的手機同步顯示並朗讀
// - 付款前送同意請求，等家人同意後才帶著 consent_token 付款
// 照顧者看得到畫面，這一頁不朗讀，避免 demo 時兩支手機同時出聲；訊息顯示在畫面上，螢幕閱讀器也會念。

import { focusOn } from './a11y.js';
import { api, clearLogin, getToken, getUser, requireLogin } from './api.js';
import * as bridge from './bridge.js';
import { PLATE_PATTERN, createParkingForm } from './parking-form.js';
import { C } from './strings.js';
import { connectEvents } from './ws.js';

const $ = (id) => document.getElementById(id);

const state = {
  links: [],
  link: null,       // 正在幫誰操作
  sessionId: null,
  plate: '',
  amount: null,
  consentId: null,
  sendTimer: null,
  waitTimer: null,
};

let form;

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
  $('view-proxy').hidden = view !== 'proxy';
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
      text.textContent = `${link.elder.name} 已授權給你`;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'btn btn-primary';
      button.textContent = `開始幫 ${link.elder.name} 繳停車費`;
      button.addEventListener('click', () => startProxy(link));
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

// ---- 代操作 ----

async function startProxy(link) {
  let res;
  try {
    res = await api('/api/care/sessions', { method: 'POST', body: { link_id: link.link_id } });
  } catch (error) {
    handleError(error);
    refresh().catch(() => {});
    return;
  }
  Object.assign(state, { link, sessionId: res.session_id, plate: '', amount: null, consentId: null });
  $('proxy-title').textContent = `幫 ${link.elder.name} 繳停車費`;
  $('proxy-result').hidden = true;
  $('consent-wait').hidden = true;
  form = createParkingForm($('proxy-form'), { onPlateInput, onQuery, onPay });
  form.setStep(1);
  show('proxy');
  focusOn($('proxy-title'));
  notify('');
  sendStep(1, {});
}

/** 送一則畫面事件給後端（後端檢查授權、產生提示句，再推給家人） */
async function sendStep(step, fields) {
  if (!state.sessionId) return;
  try {
    await api(`/api/care/sessions/${state.sessionId}/events`, {
      method: 'POST',
      body: { action_type: 'pay_parking', step, fields },
    });
  } catch (error) {
    if (error.status === 403) leaveProxy();
    handleError(error);
  }
}

function onPlateInput(plate) {
  state.plate = plate;
  state.amount = null;
  form.setFields({ amount: null });
  form.setPayEnabled(false);
  form.setStep(2);
  // 打字時等 0.3 秒沒有再輸入才送，不用每按一個鍵就送一次
  clearTimeout(state.sendTimer);
  state.sendTimer = setTimeout(() => sendStep(2, { plate }), 300);
}

async function onQuery() {
  const plate = form.getPlate();
  if (!PLATE_PATTERN.test(plate)) {
    notify(C.badPlate);
    form.focusPlate();
    return;
  }
  clearTimeout(state.sendTimer);
  form.setBusy(true);
  try {
    const bill = await api(`/api/actions/parking-bill?plate=${encodeURIComponent(plate)}`);
    Object.assign(state, { plate, amount: bill.amount });
    form.setFields({ plate, amount: bill.amount });
    form.setStep(3);
    form.setPayEnabled(true);
    notify(`查到待繳金額 ${bill.amount} 元（模擬資料）。`);
    sendStep(3, { plate, amount: bill.amount });
  } catch (error) {
    handleError(error);
  } finally {
    form.setBusy(false);
  }
}

async function onPay() {
  form.setPayEnabled(false);
  let res;
  try {
    res = await api('/api/consent/requests', {
      method: 'POST',
      body: { session_id: state.sessionId, action_type: 'pay_parking', payload: { plate: state.plate, amount: state.amount } },
    });
  } catch (error) {
    form.setPayEnabled(true);
    handleError(error);
    return;
  }
  state.consentId = res.consent_id;
  $('consent-wait-text').textContent = C.waitingConsent(res.elder_name);
  $('consent-wait').hidden = false;
  notify(C.waitingConsent(res.elder_name));
  const end = Date.now() + res.ttl_seconds * 1000;
  const tick = () => {
    const left = Math.max(0, Math.round((end - Date.now()) / 1000));
    $('consent-wait-countdown').textContent = C.waitCountdown(left);
  };
  tick();
  clearInterval(state.waitTimer);
  state.waitTimer = setInterval(tick, 1000);
}

async function onConsentResolved(data) {
  if (data.consent_id !== state.consentId) return;
  clearInterval(state.waitTimer);
  $('consent-wait').hidden = true;
  state.consentId = null;

  if (data.result !== 'approved') {
    notify(data.speak);
    form.setPayEnabled(true);
    return;
  }

  // 家人同意了：帶著 consent_token 付款。後端會比對金額、車牌是否和同意時一樣
  const amount = $('tamper').checked ? 1200 : state.amount;
  try {
    const res = await api('/api/actions/pay-parking', {
      method: 'POST',
      body: {
        plate: state.plate,
        amount,
        acting_for: state.link.elder.id,
        session_id: state.sessionId,
        consent_token: data.consent_token,
      },
    });
    showResult(C.paidResult(res.receipt_id), false);
    notify(`${data.speak}${C.paidResult(res.receipt_id)}`);
  } catch (error) {
    showResult(error.message, true);
    handleError(error);
    form.setPayEnabled(true);
  }
}

function showResult(text, isError) {
  const result = $('proxy-result');
  result.textContent = text;
  result.classList.toggle('error', isError);
  result.hidden = false;
}

async function endProxy() {
  if (!state.sessionId) return;
  const id = state.sessionId;
  leaveProxy();
  await api(`/api/care/sessions/${id}/end`, { method: 'POST' }).catch(() => {});
}

function leaveProxy() {
  clearTimeout(state.sendTimer);
  clearInterval(state.waitTimer);
  Object.assign(state, { link: null, sessionId: null, consentId: null });
  show('home');
  focusOn($('page-title'));
  refresh().catch(() => {});
}

// ---- 後端推送的事件 ----

const handlers = {
  async link_activated(data) {
    await refresh().catch(() => {});
    notify(data.speak);
  },
  async link_closed(data) {
    if (state.link?.link_id === data.link_id) leaveProxy();
    else await refresh().catch(() => {});
    notify(data.speak);
  },
  session_ended(data) {
    if (data.session_id === state.sessionId) leaveProxy();
    notify(data.speak);
  },
  consent_resolved: onConsentResolved,
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
  const actions = {
    scan,
    end: endProxy,
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

  connectEvents({
    token: getToken(),
    onEvent: (type, data) => handlers[type]?.(data),
    onOpen: () => refresh().catch(handleError),
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
