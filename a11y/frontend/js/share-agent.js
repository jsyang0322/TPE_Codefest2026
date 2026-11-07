/*
 * 無障礙輔助：分享畫面程式（在被照顧者的手機上執行）
 *
 * 分享開始後，台北通 App 會把這個程式放進之後打開的每個服務網頁（見 a11y/townpass/）。它會：
 * 1. 用開源的 rrweb 記錄頁面的結構與變化，透過 /ws/share 送給後端，再轉給照顧者。傳的是文字，不是影片。
 * 2. 執行照顧者的操作：點按、填寫、捲動、上一頁。每個動作都會在畫面上標出來並念出來。
 * 3. 送出、付款這類重要按鈕，先問被照顧者「同意嗎？」，同意才按。密碼欄位照顧者不能填。
 * 4. 畫面下方一直顯示「王小美 正在看你的畫面」和「停止分享」按鈕。
 *
 * 這個檔案會被放進別人的網頁，所以不使用 import、不污染全域變數，介面放在封閉的 Shadow DOM 裡。
 * 設定由 App（或示範頁）放在 window.__A11Y_SHARE__：{ server, token, caregiverName, elderName }。
 */
(function () {
  'use strict';

  var config = window.__A11Y_SHARE__;
  var lib = window.__a11yRrwebRecord || window.rrwebRecord;
  if (!config || !config.server || !config.token || !lib || !lib.record) return;
  if (window.__a11yShareAgent || window.top !== window) return; // 只在最上層頁面執行一次
  var serverOrigin;
  try {
    serverOrigin = new URL(config.server).origin;
  } catch (e) {
    return;
  }
  // 無障礙輔助自己的頁面不需要分享（電腦測試用的模擬服務頁 /demo/ 除外）
  if (location.origin === serverOrigin && location.pathname.indexOf('/demo/') !== 0) return;
  window.__a11yShareAgent = true;

  var record = lib.record;
  var flutter = window.flutterObject;
  var CAREGIVER = config.caregiverName || '家人';
  var ELDER = config.elderName || '你';
  var WS_URL = serverOrigin.replace(/^http/, 'ws') + '/ws/share?token=' + encodeURIComponent(config.token);

  // 重要按鈕：按下去之前一定要被照顧者同意
  var IMPORTANT = /付款|繳費|繳納|支付|結帳|購買|訂購|轉帳|儲值|扣款|送出|提交|確認|確定|申請|報名|預約|刪除|註銷|解除|登出|變更|修改|同意/;
  var ACCEPT = ['同意', '好', '可以', '對', '沒問題', '確定'];
  var REJECT = ['不同意', '不要', '不行', '不好', '取消', '等一下', '不'];

  var ws = null;
  var stopRecording = null;
  var stopped = false;
  var leaving = false;
  var retries = 0;
  var queue = [];
  var flushTimer = null;
  var pingTimer = null;
  var pageTimer = null;
  var lastPage = '';
  var asking = null; // 正在問被照顧者的問題

  // ---- 和台北通 App 溝通（格式同 frontend/js/bridge.js） ----

  var seq = 0;
  function parse(raw) {
    try {
      return typeof raw === 'string' ? JSON.parse(raw) : raw;
    } catch (e) {
      return null;
    }
  }

  function request(name, data, timeoutMs) {
    var id = 'a11y-share-' + ++seq;
    return new Promise(function (resolve, reject) {
      var timer = setTimeout(function () {
        cleanup();
        reject(new Error('timeout'));
      }, timeoutMs);
      function cleanup() {
        clearTimeout(timer);
        flutter.removeEventListener('message', onMessage);
      }
      function onMessage(event) {
        var msg = parse(event.data);
        if (!msg || msg.name !== name || !msg.data || msg.data.id !== id || msg.data.status === 'partial') return;
        cleanup();
        if (msg.data.status === 'done') resolve(msg.data);
        else reject(msg.data);
      }
      flutter.addEventListener('message', onMessage);
      data.id = id;
      flutter.postMessage(JSON.stringify({ name: name, data: data }));
    });
  }

  function speak(text) {
    if (!text) return Promise.resolve();
    if (flutter) return request('tts_speak', { text: text }, 60000).catch(function () {});
    var synth = window.speechSynthesis;
    if (!synth || !window.SpeechSynthesisUtterance) return Promise.resolve();
    synth.cancel();
    return new Promise(function (resolve) {
      var timer = setTimeout(resolve, text.length * 400 + 3000);
      var u = new SpeechSynthesisUtterance(text);
      u.lang = 'zh-TW';
      u.onend = u.onerror = function () {
        clearTimeout(timer);
        resolve();
      };
      synth.speak(u);
    });
  }

  function stopSpeaking() {
    if (flutter) flutter.postMessage(JSON.stringify({ name: 'tts_speak', data: { action: 'stop' } }));
    else if (window.speechSynthesis) window.speechSynthesis.cancel();
  }

  function listen() {
    if (!flutter) return Promise.reject(new Error('unavailable'));
    return request('voice_listen', { action: 'start', locale: 'zh-TW' }, 20000).then(function (r) {
      return String(r.text || '');
    });
  }

  function stopListening() {
    if (flutter) flutter.postMessage(JSON.stringify({ name: 'voice_listen', data: { action: 'stop' } }));
  }

  function answerOf(text) {
    var t = text.replace(/[，。！？、,.!?\s]/g, '');
    if (REJECT.some(function (w) { return t.indexOf(w) >= 0; })) return 'no';
    if (ACCEPT.some(function (w) { return t.indexOf(w) >= 0; })) return 'yes';
    return 'unknown';
  }

  // ---- 畫面上的提示（Shadow DOM，不受原網頁的樣式影響，也不會被錄進分享畫面） ----

  var host = document.createElement('div');
  host.id = 'a11y-share-ui';
  // 外框大小是 0：rrweb 會把它記成同樣大小的空白方塊，不能佔位置。裡面的提示列、對話框都是 position:fixed
  host.style.cssText = 'all:initial;position:fixed;top:0;left:0;width:0;height:0;overflow:visible;z-index:2147483647;pointer-events:none;';
  var ui = host.attachShadow({ mode: 'closed' });
  ui.innerHTML =
    '<style>' +
    ':host{all:initial}' +
    '*{box-sizing:border-box;font-family:"PingFang TC","Noto Sans TC","Microsoft JhengHei",system-ui,sans-serif}' +
    '.bar{pointer-events:auto;position:fixed;left:0;right:0;bottom:0;display:flex;align-items:center;gap:12px;' +
    'padding:12px 16px calc(12px + env(safe-area-inset-bottom,0px));background:#f6b94b;color:#1f2b2e;' +
    'box-shadow:0 -2px 12px rgba(0,0,0,.18)}' +
    '.bar p{margin:0;flex:1;font-size:18px;font-weight:700;line-height:1.4}' +
    '.dot{display:inline-block;width:12px;height:12px;border-radius:50%;background:#c0392b;margin-right:8px;vertical-align:1px}' +
    'button{font:inherit;font-size:18px;font-weight:700;min-height:52px;border-radius:12px;padding:0 18px;cursor:pointer}' +
    '.stop{background:#c0392b;color:#fff;border:0}' +
    '.toast{position:fixed;left:16px;right:16px;top:calc(16px + env(safe-area-inset-top,0px));background:rgba(31,43,46,.94);' +
    'color:#fff;font-size:18px;font-weight:700;line-height:1.5;padding:14px 16px;border-radius:12px;transition:opacity .3s}' +
    '.ring{position:fixed;border:4px solid #f6b94b;border-radius:10px;box-shadow:0 0 0 4px rgba(246,185,75,.35);transition:opacity .4s}' +
    '.shade{pointer-events:auto;position:fixed;inset:0;background:rgba(0,0,0,.45);display:flex;align-items:flex-end}' +
    '.card{width:100%;background:#fff;color:#1f2b2e;border-radius:18px 18px 0 0;padding:24px 20px calc(24px + env(safe-area-inset-bottom,0px));' +
    'display:flex;flex-direction:column;gap:12px}' +
    '.card h2{margin:0;font-size:24px;line-height:1.4}' +
    '.card p{margin:0;font-size:17px;line-height:1.6;color:#455357}' +
    '.yes{background:#2f6a75;color:#fff;border:0}' +
    '.no{background:#fff;color:#2f6a75;border:2px solid #2f6a75}' +
    '[hidden]{display:none!important}' +
    '@media (prefers-reduced-motion:reduce){.toast,.ring{transition:none}}' +
    '</style>' +
    '<div class="ring" hidden></div>' +
    '<div class="toast" role="status" hidden></div>' +
    '<div class="bar"><p><span class="dot"></span><span class="who"></span></p><button class="stop" type="button">停止分享</button></div>' +
    '<div class="shade" hidden><div class="card" role="alertdialog" aria-modal="true">' +
    '<h2 class="q"></h2><p class="hint"></p>' +
    '<button class="yes" type="button"></button><button class="no" type="button"></button></div></div>';

  var $ = function (selector) {
    return ui.querySelector(selector);
  };
  $('.who').textContent = CAREGIVER + ' 正在看你的畫面';

  // 讓頁面最下方的內容不會被提示列蓋住
  var spacer = document.createElement('div');
  spacer.id = 'a11y-share-spacer';
  spacer.style.cssText = 'height:96px';

  function mountUi() {
    if (!document.body) return;
    if (!host.isConnected) document.documentElement.appendChild(host);
    if (!spacer.isConnected) document.body.appendChild(spacer);
  }

  var toastTimer = null;
  function announce(text) {
    var toast = $('.toast');
    toast.textContent = text;
    toast.hidden = false;
    toast.style.opacity = '1';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      toast.style.opacity = '0';
      setTimeout(function () { toast.hidden = true; }, 300);
    }, 3500);
    stopSpeaking();
    speak(text);
  }

  var ringTimer = null;
  function highlight(el) {
    var rect = el.getBoundingClientRect();
    var ring = $('.ring');
    ring.style.left = rect.left - 6 + 'px';
    ring.style.top = rect.top - 6 + 'px';
    ring.style.width = rect.width + 12 + 'px';
    ring.style.height = rect.height + 12 + 'px';
    ring.hidden = false;
    ring.style.opacity = '1';
    clearTimeout(ringTimer);
    ringTimer = setTimeout(function () {
      ring.style.opacity = '0';
      setTimeout(function () { ring.hidden = true; }, 400);
    }, 1800);
  }

  /** 問被照顧者，回傳 Promise<boolean>。可以按按鈕，在台北通裡也可以用說的。60 秒沒回答當作不同意。 */
  function ask(question, yesText, noText) {
    if (asking) asking(false);
    var shade = $('.shade');
    $('.q').textContent = question;
    $('.hint').textContent = flutter ? '也可以用說的：「' + yesText + '」或「' + noText + '」。' : '';
    $('.yes').textContent = yesText;
    $('.no').textContent = noText;
    shade.hidden = false;
    $('.yes').focus();

    return new Promise(function (resolve) {
      var done = false;
      var timer = setTimeout(function () { finish(false); }, 60000);
      function finish(answer) {
        if (done) return;
        done = true;
        clearTimeout(timer);
        asking = null;
        shade.hidden = true;
        stopListening();
        resolve(answer);
      }
      asking = finish;
      $('.yes').onclick = function () { finish(true); };
      $('.no').onclick = function () { finish(false); };

      var tries = 0;
      function voiceRound(prompt) {
        speak(prompt).then(function () {
          if (done || !flutter) return;
          listen().then(function (text) {
            if (done) return;
            var answer = answerOf(text);
            if (answer !== 'unknown') finish(answer === 'yes');
            else if (++tries < 2) voiceRound('沒有聽清楚。' + yesText + '請說「' + yesText + '」，' + noText + '請說「' + noText + '」。');
            else speak('請按畫面上的按鈕。');
          }, function () {});
        });
      }
      stopSpeaking();
      voiceRound(question + yesText + '請說「' + yesText + '」，' + noText + '請說「' + noText + '」。');
    });
  }

  $('.stop').onclick = function () {
    ask('確定不讓 ' + CAREGIVER + ' 看你的畫面了嗎？', '確定停止', '取消').then(function (yes) {
      if (!yes) return;
      send({ type: 'stop' });
      teardown('分享已結束，' + CAREGIVER + ' 看不到你的畫面了。');
    });
  };

  // ---- 照顧者的操作 ----

  function nodeFor(id) {
    var node = record.mirror.getNode(id);
    if (node && node.nodeType === 3) node = node.parentElement;
    return node && node.nodeType === 1 && node.isConnected ? node : null;
  }

  function clean(text, limit) {
    text = String(text || '').replace(/\s+/g, ' ').trim();
    return text.length > limit ? text.slice(0, limit) + '…' : text;
  }

  function labelOf(el) {
    var type = (el.getAttribute('type') || '').toLowerCase();
    var text = el.tagName === 'INPUT' && /^(button|submit|reset)$/.test(type) ? el.value : '';
    text = text || el.getAttribute('aria-label') || el.innerText || el.textContent || el.getAttribute('title') || '';
    return clean(text, 20) || '這個按鈕';
  }

  function fieldName(el) {
    var text = '';
    if (el.id) {
      var label = document.querySelector('label[for="' + (window.CSS && CSS.escape ? CSS.escape(el.id) : el.id) + '"]');
      if (label) text = label.innerText;
    }
    if (!text && el.closest('label')) text = el.closest('label').innerText;
    text = text || el.getAttribute('aria-label') || el.getAttribute('placeholder') || el.getAttribute('name') || '';
    return clean(text, 16) || '這個欄位';
  }

  function isImportant(el, label) {
    if (IMPORTANT.test(label)) return true;
    var type = (el.getAttribute('type') || '').toLowerCase();
    if (el.tagName === 'BUTTON' && (type === '' || type === 'submit') && el.form) return true; // 表單裡的按鈕預設就是送出
    return el.tagName === 'INPUT' && type === 'submit';
  }

  function isFillable(el) {
    if (el.isContentEditable) return true;
    if (el.tagName === 'TEXTAREA' || el.tagName === 'SELECT') return true;
    return el.tagName === 'INPUT' && !/^(button|submit|reset|checkbox|radio|file|image|hidden|range|color)$/i.test(el.type);
  }

  function setValue(el, value) {
    if (el.isContentEditable) {
      el.textContent = value;
    } else {
      var proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : el.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
      // 用原生的 setter，React、Vue 這類框架才會收到變化
      Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
    }
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function bringIntoView(el) {
    var rect = el.getBoundingClientRect();
    if (rect.top < 0 || rect.bottom > window.innerHeight - 96) el.scrollIntoView({ block: 'center' });
  }

  function handleCommand(cmd) {
    function reply(ok, message) {
      send({ type: 'result', command_id: cmd.command_id, ok: ok, message: message });
    }
    if (asking) {
      reply(false, '正在等 ' + ELDER + ' 回答，請稍等。');
      return;
    }
    if (cmd.action === 'scroll') {
      window.scrollBy({ top: cmd.dy, behavior: 'smooth' });
      reply(true, '');
      return;
    }
    if (cmd.action === 'back') {
      announce(CAREGIVER + ' 回到上一頁');
      reply(true, '已回到上一頁');
      setTimeout(function () { history.back(); }, 400);
      return;
    }

    var node = nodeFor(cmd.node_id);
    if (!node) {
      reply(false, '畫面已經變了，請再點一次。');
      return;
    }

    if (cmd.action === 'input') {
      var field = node.closest('input,textarea,select,[contenteditable]') || node;
      if (field.tagName === 'INPUT' && field.type === 'password') {
        announce(CAREGIVER + ' 不能幫你填密碼，密碼請你自己輸入。');
        reply(false, '密碼請 ' + ELDER + ' 自己輸入。');
        return;
      }
      if (!isFillable(field)) {
        reply(false, '這裡不能填寫。');
        return;
      }
      var name = fieldName(field);
      bringIntoView(field);
      highlight(field);
      setValue(field, String(cmd.value));
      announce(CAREGIVER + ' 幫你填了「' + name + '」');
      reply(true, '已填好「' + name + '」。');
      return;
    }

    var el = node.closest('a,button,input,select,textarea,label,summary,[role="button"],[role="link"],[role="checkbox"],[role="radio"],[role="tab"],[onclick]') || node;
    var label = labelOf(el);
    bringIntoView(el);
    highlight(el);
    if (isImportant(el, label)) {
      ask(CAREGIVER + ' 想幫你按「' + label + '」，同意嗎？', '同意', '不同意').then(function (yes) {
        if (!yes) {
          speak('好的，沒有按。');
          reply(false, ELDER + ' 不同意按「' + label + '」。');
          return;
        }
        if (!el.isConnected) {
          reply(false, '畫面已經變了，請再點一次。');
          return;
        }
        el.click();
        reply(true, ELDER + ' 同意了，已按下「' + label + '」。');
      });
      return;
    }
    announce(CAREGIVER + ' 按了「' + label + '」');
    el.click();
    reply(true, '已按下「' + label + '」。');
  }

  // ---- 記錄畫面並送出 ----

  function send(message) {
    if (ws && ws.readyState === 1) ws.send(JSON.stringify(message));
  }

  function flush() {
    flushTimer = null;
    if (!queue.length) return;
    var batch = queue;
    queue = [];
    if (ws && ws.readyState === 1) ws.send(JSON.stringify({ type: 'events', events: batch }));
  }

  function emit(event) {
    queue.push(event);
    if (!flushTimer) flushTimer = setTimeout(flush, 120);
  }

  function startRecording() {
    if (stopRecording) {
      try {
        record.takeFullSnapshot(true);
      } catch (e) {
        // 還沒準備好時，下一次再送
      }
      return;
    }
    stopRecording = record({
      emit: emit,
      blockSelector: '#a11y-share-ui,#a11y-share-spacer',
      maskInputOptions: { password: true },
      sampling: { mousemove: false, scroll: 150, input: 'last' },
      recordCanvas: false,
      collectFonts: false,
      inlineImages: false,
      slimDOMOptions: { script: true, comment: true, headFavicon: true, headWhitespace: true, headMetaSocial: true, headMetaRobots: true, headMetaHttpEquiv: true, headMetaVerification: true, headMetaAuthorship: true, headMetaDescKeywords: true },
    });
  }

  function sendPage() {
    var key = location.href + '\n' + document.title;
    if (key === lastPage) return;
    lastPage = key;
    send({ type: 'page', url: location.href, title: document.title });
  }

  function connect() {
    if (stopped) return;
    ws = new WebSocket(WS_URL);
    ws.onopen = function () {
      retries = 0;
      lastPage = '';
      sendPage();
      startRecording();
      clearInterval(pingTimer);
      pingTimer = setInterval(function () { send({ type: 'ping' }); }, 20000);
    };
    ws.onmessage = function (event) {
      var msg = parse(event.data);
      if (!msg) return;
      if (msg.type === 'command') handleCommand(msg);
      else if (msg.type === 'snapshot') startRecording();
      else if (msg.type === 'closed') teardown('分享已結束，' + CAREGIVER + ' 看不到你的畫面了。');
    };
    ws.onclose = function (event) {
      clearInterval(pingTimer);
      if (stopped || leaving) return;
      if (event.code === 4401 || event.code === 4000) {
        teardown(event.code === 4000 ? '分享已結束，' + CAREGIVER + ' 看不到你的畫面了。' : '');
        return;
      }
      retries += 1;
      setTimeout(connect, Math.min(10000, 1000 * Math.pow(2, retries)));
    };
  }

  /** 停止分享：停止記錄、移除提示，並請 App 不要再把分享程式放進之後打開的網頁 */
  function teardown(message) {
    if (stopped) return;
    stopped = true;
    if (asking) asking(false);
    if (stopRecording) stopRecording();
    stopRecording = null;
    clearInterval(pingTimer);
    clearInterval(pageTimer);
    if (ws && ws.readyState <= 1) ws.close();
    host.remove();
    spacer.remove();
    if (flutter) flutter.postMessage(JSON.stringify({ name: 'a11y_share_stop', data: null }));
    try {
      if (location.origin === serverOrigin) sessionStorage.removeItem('a11y.share');
    } catch (e) {
      // 瀏覽器不允許存取時略過
    }
    if (message) speak(message);
  }

  function start() {
    mountUi();
    connect();
    pageTimer = setInterval(function () {
      mountUi(); // 有些網頁會整個換掉 body
      sendPage(); // 單頁式網站換頁時網址會變
    }, 1500);
    // 離開這一頁時馬上斷線，照顧者那邊才會立刻知道；從上一頁按回來（頁面被保留）時再連上
    window.addEventListener('pagehide', function () {
      leaving = true;
      if (ws) ws.close();
    });
    window.addEventListener('pageshow', function (event) {
      if (!event.persisted || stopped) return;
      leaving = false;
      connect();
    });
  }

  if (document.body) start();
  else document.addEventListener('DOMContentLoaded', start);
})();
