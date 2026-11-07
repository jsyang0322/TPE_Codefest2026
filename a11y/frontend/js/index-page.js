// 首頁：demo 登入，以及手機實測用的連線狀態。

import { api, getUser, saveLogin } from './api.js';
import { inApp } from './bridge.js';

const $ = (id) => document.getElementById(id);

function showStatus(id, ok, text) {
  const el = $(id);
  el.textContent = text;
  el.className = ok ? 'ok' : 'bad';
}

// 從其他頁跳回來登入時，登入後回到原本那一頁（例如還沒登入就打開 caregiver.html）
function nextPage(defaultPage) {
  const next = new URLSearchParams(location.search).get('next') ?? '';
  const page = next.split('?')[0];
  return page === defaultPage ? next : defaultPage;
}

document.addEventListener('click', async (event) => {
  const button = event.target.closest('[data-login]');
  if (!button) return;
  $('login-error').textContent = '';
  try {
    saveLogin(await api('/api/auth/login', { method: 'POST', body: { user_id: button.dataset.login } }));
    location.href = nextPage(button.dataset.page);
  } catch (error) {
    $('login-error').textContent = error.message;
  }
});

const user = getUser();
if (user) {
  $('logged-in').textContent = `這個分頁目前以 ${user.name} 登入；重新選擇會換成新的登入。`;
  $('logged-in').hidden = false;
}

fetch('/api/health')
  .then((res) => res.json())
  .then((body) => showStatus('status-backend', body.ok, body.ok ? '連線正常' : '回應異常'))
  .catch(() => showStatus('status-backend', false, '連不到後端'));
showStatus('status-app', inApp, inApp ? '是，可以使用手機的語音辨識與朗讀' : '否，目前在一般瀏覽器');
