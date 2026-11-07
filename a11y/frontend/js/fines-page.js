// 示範服務「交通罰單」（demo/fines.html）：查罰單、選付款方式、繳費。資料是假的（backend/fines.py）。
//
// 畫面用網址的 # 切換（#fine/f1、#done/f1），台北通的「上一頁」就能回到上一個畫面。
// 電腦測試沒有台北通 App：像模擬服務頁一樣自己載入分享程式（rrweb），家人才看得到這一頁。

const $ = (id) => document.getElementById(id);

const state = { data: null, method: 'card', paying: false };

const money = (value) => value.toLocaleString('zh-TW');

/** "2026-10-21T14:32+08:00" → "民國 115 年 10 月 21 日 14:32"（short：115/10/21） */
function rocDate(iso, { short = false, time = true } = {}) {
  if (!iso) return '';
  const [, y, m, d, hh, mm] = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(iso) ?? [];
  if (!y) return iso;
  const year = Number(y) - 1911;
  const clock = time ? ` ${hh}:${mm}` : '';
  return short ? `${year}/${m}/${d}${clock}` : `民國 ${year} 年 ${Number(m)} 月 ${Number(d)} 日${clock}`;
}

function token() {
  try {
    return sessionStorage.getItem('a11y.token');
  } catch {
    return null;
  }
}

async function request(path, body) {
  const headers = { Accept: 'application/json' };
  if (token()) headers.Authorization = `Bearer ${token()}`;
  if (body) headers['Content-Type'] = 'application/json';
  let res;
  try {
    res = await fetch(path, { method: body ? 'POST' : 'GET', headers, body: body ? JSON.stringify(body) : undefined });
  } catch {
    throw new Error('連不上伺服器，請確認網路。');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message ?? '發生錯誤，請再試一次。');
  return data;
}

function showError(message) {
  $('error').textContent = message ?? '';
  $('error').hidden = !message;
}

function announce(text) {
  $('announce').textContent = '';
  setTimeout(() => ($('announce').textContent = text), 50);
}

function show(view) {
  for (const name of ['list', 'detail', 'done']) $(`view-${name}`).hidden = name !== view;
  $('loading').hidden = true;
  window.scrollTo(0, 0);
}

function fields(list, rows) {
  list.replaceChildren(
    ...rows.flatMap(([name, value]) => [
      Object.assign(document.createElement('dt'), { textContent: name }),
      Object.assign(document.createElement('dd'), { textContent: value }),
    ]),
  );
}

// ---- 列表 ----

function fineCard(fine) {
  const item = document.createElement('li');
  const link = document.createElement('a');
  link.className = `fine${fine.status === 'paid' ? ' paid' : ''}`;
  link.href = `#fine/${fine.id}`;
  // 台北通念「王小美 按了『…』」時用這段文字
  link.setAttribute('aria-label', fine.status === 'paid' ? `${fine.title}，已繳` : `${fine.title}，${money(fine.amount)} 元，看明細`);
  link.innerHTML = `
    <span class="fine-main">
      <span class="fine-top"><strong class="fine-title"></strong><strong class="fine-amount"></strong></span>
      <span class="fine-meta"></span>
      <span class="chip"></span>
    </span>
    <svg class="chev" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M9 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  link.querySelector('.fine-title').textContent = fine.title;
  link.querySelector('.fine-meta').textContent = `${rocDate(fine.time, { short: true, time: false })}・${fine.place}`;
  link.querySelector('.fine-amount').textContent = `${money(fine.amount)} 元`;
  const chip = link.querySelector('.chip');
  chip.textContent = fine.status === 'paid' ? '已繳' : `待繳・${rocDate(fine.due, { short: true, time: false })} 前`;
  chip.classList.add(fine.status === 'paid' ? 'ok' : 'warn');
  item.append(link);
  return item;
}

function renderList() {
  const { owner, fines } = state.data;
  $('owner-name').textContent = owner.name;
  $('owner-plate').textContent = owner.plate;
  const unpaid = fines.filter((fine) => fine.status === 'unpaid');
  const paid = fines.filter((fine) => fine.status === 'paid');
  $('due-count').textContent = unpaid.length;
  $('due-amount').textContent = money(unpaid.reduce((sum, fine) => sum + fine.amount, 0));
  $('unpaid-empty').hidden = unpaid.length > 0;
  $('unpaid-list').replaceChildren(...unpaid.map(fineCard));
  $('paid-list').replaceChildren(...paid.map(fineCard));
  show('list');
}

// ---- 明細 ----

function renderDetail(fine) {
  const paid = fine.status === 'paid';
  $('detail-chip').textContent = paid ? '已繳' : '待繳';
  $('detail-chip').className = `chip ${paid ? 'ok' : 'warn'}`;
  $('detail-title').textContent = fine.title;
  $('detail-amount').textContent = money(fine.amount);
  const rows = [
    ['舉發單號', fine.no],
    ['違規時間', rocDate(fine.time)],
    ['違規地點', fine.place],
    ['車牌號碼', state.data.owner.plate],
    ['舉發單位', fine.unit],
    ['違反條款', fine.law],
    ['應到案日期', rocDate(fine.due, { time: false })],
  ];
  if (paid) rows.push(['繳費時間', rocDate(fine.paid_at)], ['付款方式', fine.method], ['收據編號', fine.receipt_no]);
  fields($('detail-fields'), rows);

  $('pay-box').hidden = paid;
  if (!paid) {
    $('method-list').replaceChildren(
      ...state.data.methods.map((method) => {
        const label = document.createElement('label');
        label.className = 'method';
        const input = Object.assign(document.createElement('input'), { type: 'radio', name: 'method', value: method.id });
        input.checked = method.id === state.method;
        input.addEventListener('change', () => (state.method = method.id));
        const text = Object.assign(document.createElement('span'), { textContent: method.label });
        label.append(input, text);
        return label;
      }),
    );
    $('pay').textContent = `確認繳費 ${money(fine.amount)} 元`;
    $('pay').disabled = false;
    $('pay').dataset.fine = fine.id;
  }
  show('detail');
}

async function pay() {
  const fineId = $('pay').dataset.fine;
  if (state.paying || !fineId) return;
  state.paying = true;
  $('pay').disabled = true;
  $('pay').textContent = '繳費中…';
  showError('');
  try {
    const { fine } = await request(`/api/fines/${fineId}/pay`, { method: state.method });
    state.data.fines = state.data.fines.map((item) => (item.id === fine.id ? fine : item));
    // 用 replace：繳完按「上一頁」回到列表，不會回到付款畫面
    location.replace(`#done/${fine.id}`);
  } catch (error) {
    showError(error.message);
    $('pay').disabled = false;
    $('pay').textContent = `確認繳費 ${money(state.data.fines.find((item) => item.id === fineId)?.amount ?? 0)} 元`;
  } finally {
    state.paying = false;
  }
}

// ---- 完成 ----

function renderDone(fine) {
  $('done-amount').textContent = money(fine.amount);
  fields($('done-fields'), [
    ['罰單', fine.title],
    ['收據編號', fine.receipt_no],
    ['繳費時間', rocDate(fine.paid_at)],
    ['付款方式', fine.method],
  ]);
  show('done');
  $('done-title').focus();
  announce(`繳費成功，${money(fine.amount)} 元，收據編號 ${fine.receipt_no}`);
}

// ---- 切換畫面 ----

function route() {
  if (!state.data) return;
  showError('');
  const [view, id] = location.hash.replace(/^#/, '').split('/');
  const fine = state.data.fines.find((item) => item.id === id);
  if (view === 'fine' && fine) renderDetail(fine);
  else if (view === 'done' && fine?.status === 'paid') renderDone(fine);
  else renderList();
}

async function load() {
  try {
    state.data = await request('/api/fines');
    route();
  } catch (error) {
    $('loading').hidden = true;
    showError(error.message);
  }
}

// 電腦測試：沒有台北通 App，自己載入分享程式（設定由「讓家人幫忙」頁存在 sessionStorage）
function loadShareAgent() {
  if (window.flutterObject) return;
  $('back-link').hidden = false;
  try {
    window.__A11Y_SHARE__ = JSON.parse(sessionStorage.getItem('a11y.share') || 'null');
  } catch {
    window.__A11Y_SHARE__ = null;
  }
  if (!window.__A11Y_SHARE__) return;
  const lib = document.createElement('script');
  lib.src = '../vendor/rrweb/record.min.js';
  lib.onload = () => {
    const agent = document.createElement('script');
    agent.src = '../js/share-agent.js';
    document.body.append(agent);
  };
  document.body.append(lib);
}

$('pay').addEventListener('click', pay);
window.addEventListener('hashchange', route);
loadShareAgent();
load();
