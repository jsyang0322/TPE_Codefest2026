// WebSocket：接收後端推送的事件（規格第二部分第 6 節）。
// 斷線時每 3 秒重連；每 20 秒送一次 ping，讓後端知道頁面還開著。
// 重新連上時呼叫 onOpen，頁面可以趁機向後端要最新狀態（例如斷網期間錯過的事件）。

const RECONNECT_MS = 3000;
const PING_MS = 20000;

export function connectEvents({ token, onEvent, onOpen, onStatus }) {
  let socket = null;
  let pingTimer = null;
  let closed = false;

  const url = () => `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws?token=${encodeURIComponent(token)}`;

  function open() {
    socket = new WebSocket(url());
    socket.addEventListener('open', () => {
      onStatus?.(true);
      onOpen?.();
      pingTimer = setInterval(() => socket.readyState === WebSocket.OPEN && socket.send('{"type":"ping"}'), PING_MS);
    });
    socket.addEventListener('message', (event) => {
      let message;
      try {
        message = JSON.parse(event.data);
      } catch {
        return;
      }
      if (message.type && message.type !== 'pong') onEvent(message.type, message.data ?? {});
    });
    socket.addEventListener('close', (event) => {
      clearInterval(pingTimer);
      onStatus?.(false);
      // 4401：登入已結束，不要再重連
      if (!closed && event.code !== 4401) setTimeout(open, RECONNECT_MS);
    });
  }

  open();
  return {
    close() {
      closed = true;
      socket?.close();
    },
  };
}
