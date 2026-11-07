// 功能 A：常見問題語音查詢的頁面流程（規格第一部分第 3 節）。
//
// 畫面：首頁 →（說出或打字）→ 候選問題 → 答案；另有「找不到」「全部問題」。
// 看得到畫面的人用按鈕；看不到的人用語音：系統念完後自動聽（App 會等到使用者開口，停頓約 3 秒結束）。
// 螢幕閱讀器模式：App 不另外朗讀、不自動開麥克風，改由 VoiceOver／TalkBack 念畫面。

import { announce, focusOn, isScreenReaderMode, setScreenReaderMode } from './a11y.js';
import * as bridge from './bridge.js';
import { loadFaqData, sendFeedback } from './faq-data.js';
import { popularFaqs, searchFaq } from './faq-search.js';
import { speechText } from './speech-text.js';
import { S } from './strings.js';
import { parseCommand } from './voice-commands.js';

const $ = (id) => document.getElementById(id);
const VIEWS = ['loading', 'error', 'home', 'results', 'notfound', 'answer', 'all'];

// 每個畫面聽得懂的語音指令；不是指令的話，都當成新的問題去查
const COMMANDS = {
  home: ['call', 'all'],
  results: ['select', 'repeat', 'none', 'back', 'call', 'all'],
  notfound: ['repeat', 'none', 'back', 'call', 'all'],
  answer: ['repeat', 'next', 'back', 'none', 'call', 'all'],
  all: ['back', 'call'],
};

const state = {
  data: null,        // GET /api/faq 的內容
  view: 'loading',
  query: '',         // 這次查詢的文字（送查詢紀錄用）
  results: [],       // 候選問題
  faq: null,         // 正在看的問題
  segment: 0,        // 正在念第幾段
  fromResults: false,
  listening: false,
  turn: 0,           // 使用者每做一件事加 1，見 newTurn()
  lastSpeech: '',
};

// ---- 念與聽 ----

/**
 * 使用者每做一件事就換一輪：停掉正在念的、正在聽的。
 * 舊的那一輪念完或聽完後會發現 turn 已經變了，就不再接著做事（例如念到一半按了按鈕，不會再自動開麥克風）。
 */
function newTurn() {
  state.turn += 1;
  bridge.stopSpeaking();
  if (state.listening) {
    bridge.stopListening();
    setListening(false);
  }
  return state.turn;
}

async function say(text) {
  state.lastSpeech = text;
  await announce(text, { speech: speechText(text) });
}

/** 念完後自動聽，看不到畫面的人不用再找按鈕。螢幕閱讀器模式不自動開麥克風。 */
async function sayThenListen(text, turn) {
  await say(text);
  if (turn === state.turn && !isScreenReaderMode()) listenOnce(turn, { auto: true });
}

async function listenOnce(turn, { auto = false } = {}) {
  setListening(true);
  let text = '';
  let error = null;
  try {
    text = await bridge.listen((partial) => {
      if (turn === state.turn) $('talk-partial').textContent = partial;
    });
  } catch (e) {
    error = e;
  }
  if (turn !== state.turn) return;
  setListening(false);

  if (error) {
    // 自動聽的時候使用者沒說話很正常，不用提醒
    if (error.code === 'no_speech') {
      if (!auto) await say(S.noSpeech);
      return;
    }
    await say(error.code === 'permission' ? S.micPermission : S.micUnavailable);
    return;
  }
  handleSpeech(text);
}

function setListening(on) {
  state.listening = on;
  const button = $('btn-talk');
  button.classList.toggle('listening', on);
  button.setAttribute('aria-pressed', String(on));
  $('talk-label').textContent = on ? S.talkListening : S.talkIdle;
  $('talk-partial').textContent = on ? S.talkStopHint : '';
}

/** 語音辨識的結果：先顯示「我聽到」，是指令就執行，不是就當成問題查 */
function handleSpeech(text) {
  $('heard-text').textContent = text;
  $('heard').hidden = false;
  const command = parseCommand(text, COMMANDS[state.view] ?? []);
  if (!command) return ask(text);
  switch (command.type) {
    case 'select': return selectResult(command.index);
    case 'repeat': return repeat();
    case 'next': return nextSegment();
    case 'none': return askAgain();
    case 'back': return goBack();
    case 'call': return callHotline();
    case 'all': return showAll();
  }
}

// ---- 各畫面 ----

function show(view, focusTarget) {
  for (const name of VIEWS) $(`view-${name}`).hidden = name !== view;
  state.view = view;
  window.scrollTo(0, 0);
  focusOn(focusTarget ?? $(`view-${view}`).querySelector('h2'));
}

function showHome({ intro = false } = {}) {
  newTurn();
  $('heard').hidden = true;
  $('ask-input').value = '';
  renderPopular();
  show('home', $('page-title'));
  if (intro) say(isScreenReaderMode() ? S.introScreenReader : S.intro);
}

function ask(text) {
  const turn = newTurn();
  state.query = text;
  state.results = searchFaq(text, state.data.faqs, state.data.synonyms);

  if (state.results.length === 0) {
    sendFeedback({ query: text, matched: false });
    show('notfound');
    sayThenListen(S.notFound, turn);
    return;
  }
  renderResults();
  show('results');
  readResults(turn);
}

function readResults(turn) {
  // 螢幕閱讀器使用者會自己一個一個聽按鈕，只要告訴他找到幾個
  const text = isScreenReaderMode()
    ? `找到 ${state.results.length} 個問題。`
    : S.found(state.results.map((faq) => faq.question));
  sayThenListen(text, turn);
}

function selectResult(index) {
  const faq = state.results[index];
  if (faq) openFaq(faq, { fromResults: true });
  else sayThenListen(S.outOfRange(state.results.length), newTurn());
}

function openFaq(faq, { fromResults = false } = {}) {
  state.faq = faq;
  state.segment = 0;
  state.fromResults = fromResults;
  if (!fromResults) $('heard').hidden = true;
  sendFeedback({ query: fromResults ? state.query : '', matched: true, chosen_faq_id: faq.id });
  renderAnswer();
  show('answer', $('answer-question'));
  readSegment();
}

function readSegment() {
  const turn = newTurn();
  const { question, segments } = state.faq;
  const current = highlightSegment();

  if (isScreenReaderMode()) {
    // 焦點移到這一段，由螢幕閱讀器念
    if (state.segment > 0) focusOn(current);
    return;
  }
  const title = state.segment === 0 ? `${question.replace(/[？?]$/, '')}。\n` : '';
  const isLast = state.segment === segments.length - 1;
  sayThenListen(`${title}${segments[state.segment]}\n${isLast ? S.answerEndHint : S.answerNextHint}`, turn);
}

function nextSegment() {
  if (!state.faq) return;
  if (state.segment >= state.faq.segments.length - 1) {
    sayThenListen(S.noMoreSegments + S.answerEndHint, newTurn());
    return;
  }
  state.segment += 1;
  readSegment();
}

function repeat() {
  if (state.view === 'answer') return readSegment();
  if (state.view === 'results') return readResults(newTurn());
  sayThenListen(state.lastSpeech || S.intro, newTurn());
}

function askAgain() {
  const turn = newTurn();
  $('heard').hidden = true;
  renderPopular();
  show('home', $('page-title'));
  sayThenListen(S.askAgain, turn);
}

function goBack() {
  if (state.view === 'answer' && state.fromResults && state.results.length) {
    const turn = newTurn();
    show('results');
    readResults(turn);
    return;
  }
  showHome();
}

function showAll() {
  newTurn();
  renderAll();
  show('all');
  say(S.allIntro(state.data.faqs.length));
}

function callHotline() {
  newTurn();
  bridge.callPhone('1999');
}

function showError(message) {
  $('error-message').textContent = message;
  show('error');
  say(message);
}

// ---- 畫面內容 ----

function choiceButton(label, onClick) {
  const item = document.createElement('div');
  item.setAttribute('role', 'listitem');
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'btn btn-secondary choice';
  button.textContent = label;
  button.addEventListener('click', onClick);
  item.append(button);
  return item;
}

function renderPopular() {
  $('popular-list').replaceChildren(
    ...popularFaqs(state.data.faqs).map((faq) => choiceButton(faq.question, () => openFaq(faq))),
  );
}

function renderResults() {
  $('results-list').replaceChildren(
    ...state.results.map((faq, i) => choiceButton(S.choiceLabel(i, faq.question), () => openFaq(faq, { fromResults: true }))),
  );
}

function renderAll() {
  const sections = state.data.categories.map((category) => {
    const section = document.createElement('section');
    section.className = 'category';
    const heading = document.createElement('h3');
    heading.textContent = category;
    const list = document.createElement('div');
    list.className = 'choice-list';
    list.setAttribute('role', 'list');
    list.append(
      ...state.data.faqs
        .filter((faq) => faq.category === category)
        .map((faq) => choiceButton(faq.question, () => openFaq(faq))),
    );
    section.append(heading, list);
    return section;
  });
  $('all-list').replaceChildren(...sections);
}

function renderAnswer() {
  const { faq } = state;
  $('answer-category').textContent = faq.category;
  $('answer-question').textContent = faq.question;
  $('answer-segments').replaceChildren(
    ...faq.segments.map((segment) => {
      const item = document.createElement('li');
      appendWithLinks(item, segment);
      return item;
    }),
  );
  $('btn-back-results').hidden = !state.fromResults;
}

/** 標出正在念的那一段，回傳那一段的元素 */
function highlightSegment() {
  const items = [...$('answer-segments').children];
  items.forEach((item, i) => {
    const current = i === state.segment;
    item.classList.toggle('current', current);
    if (current) item.setAttribute('aria-current', 'step');
    else item.removeAttribute('aria-current');
  });
  items[state.segment]?.scrollIntoView({ block: 'nearest' });
  $('btn-next').disabled = state.segment >= state.faq.segments.length - 1;
  return items[state.segment];
}

/** 答案裡的網址變成可以點的連結（用 DOM 建立，不用 innerHTML） */
function appendWithLinks(element, text) {
  for (const part of text.split(/(https?:\/\/\S+)/g)) {
    if (/^https?:\/\//.test(part)) {
      const link = document.createElement('a');
      link.href = part;
      link.textContent = part;
      element.append(link);
    } else if (part) {
      element.append(part);
    }
  }
}

function renderSource(source) {
  const container = $('source');
  const link = document.createElement('a');
  link.href = source.url;
  link.textContent = source.name;
  container.replaceChildren('資料來源：', link);
  if (source.synced_at) {
    const date = new Date(source.synced_at);
    container.append(`，${S.sourceSynced(`${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()}`)}`);
  }
}

// ---- 電腦開發：沒有台北通 App 時用打字代替說話 ----

function setupMockMic() {
  if (bridge.inApp) return;
  const form = $('mock-mic');
  const input = $('mock-input');
  let resolveMic = null;

  const finish = (text) => {
    form.hidden = true;
    const resolve = resolveMic;
    resolveMic = null;
    resolve?.(text);
  };
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    finish(input.value);
  });
  $('mock-cancel').addEventListener('click', () => finish(''));

  bridge.setMockListener({
    listen: () =>
      new Promise((resolve) => {
        resolveMic?.('');
        resolveMic = resolve;
        input.value = '';
        form.hidden = false;
        input.focus();
      }),
    stop: () => finish(input.value),
  });
}

// ---- 開始 ----

function bindEvents() {
  $('btn-talk').addEventListener('click', () => {
    if (state.listening) {
      bridge.stopListening(); // 說完了：已經聽到的內容照常處理
      return;
    }
    listenOnce(newTurn());
  });

  $('ask-form').addEventListener('submit', (event) => {
    event.preventDefault();
    const text = $('ask-input').value.trim();
    if (!text) return;
    $('heard').hidden = true;
    ask(text);
  });

  const actions = {
    reload: () => window.location.reload(),
    all: showAll,
    again: askAgain,
    call: callHotline,
    home: () => showHome(),
    repeat,
    next: nextSegment,
    back: goBack,
  };
  document.addEventListener('click', (event) => {
    const button = event.target.closest('[data-action]');
    if (button) actions[button.dataset.action]?.();
  });

  const toggle = $('sr-toggle');
  toggle.checked = isScreenReaderMode();
  toggle.addEventListener('change', () => {
    newTurn();
    setScreenReaderMode(toggle.checked);
    announce(toggle.checked ? '已開啟螢幕閱讀器模式，App 不會另外朗讀。' : '已關閉螢幕閱讀器模式，App 會朗讀內容。');
  });

  // 離開頁面（切到別的 App、鎖螢幕）時停止朗讀與聆聽
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) newTurn();
  });
}

async function init() {
  setupMockMic();
  bindEvents();
  try {
    const { data, offline } = await loadFaqData();
    if (!data.faqs?.length) return showError(S.notReady);
    state.data = data;
    renderSource(data.source);
    $('offline-note').textContent = S.offlineNote;
    $('offline-note').hidden = !offline;
    $('btn-talk').disabled = false;
    showHome({ intro: true });
  } catch {
    showError(S.loadFailed);
  }
}

init();
