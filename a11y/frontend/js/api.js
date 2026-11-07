// 呼叫後端 API，以及 demo 登入的 token。
// token 存在 sessionStorage：同一台電腦開兩個分頁（或一般視窗＋無痕視窗）就能模擬兩支手機。

const TOKEN_KEY = 'a11y.token';
const USER_KEY = 'a11y.user';

export function getToken() {
  try {
    return sessionStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function getUser() {
  try {
    return JSON.parse(sessionStorage.getItem(USER_KEY) ?? 'null');
  } catch {
    return null;
  }
}

export function saveLogin({ token, user }) {
  sessionStorage.setItem(TOKEN_KEY, token);
  sessionStorage.setItem(USER_KEY, JSON.stringify(user));
}

export function clearLogin() {
  sessionStorage.removeItem(TOKEN_KEY);
  sessionStorage.removeItem(USER_KEY);
}

/**
 * 呼叫後端。失敗時 throw { status, error, message }：message 是可以直接顯示並朗讀的中文句子。
 * 401（登入已結束）時清掉 token，讓頁面回到登入畫面。
 */
export async function api(path, { method = 'GET', body } = {}) {
  const headers = { Accept: 'application/json' };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  let res;
  try {
    res = await fetch(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch {
    throw { status: 0, error: 'offline', message: '連不上伺服器，請確認網路。' };
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401) clearLogin();
    throw { status: res.status, error: data.error ?? 'error', message: data.message ?? '發生錯誤，請再試一次。' };
  }
  return data;
}

/** 沒有登入就回到首頁選擇身分；登入後會回到這一頁 */
export function requireLogin() {
  if (getToken()) return true;
  const next = location.pathname.split('/').pop() + location.search;
  location.replace(`index.html?next=${encodeURIComponent(next)}`);
  return false;
}
