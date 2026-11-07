// 模擬的「繳停車費」表單（demo 用，資料是模擬的，不會真的扣款）。
// 照顧者用可以編輯的版本；被照顧者在觀看模式看到同一個表單的唯讀版本，內容跟著照顧者同步。

export const STEPS = ['開啟繳停車費頁面', '填寫車牌', '確認金額'];
export const PLATE_PATTERN = /^[A-Z0-9]{2,4}-[A-Z0-9]{2,4}$/;

/** 「abc 1234」→「ABC-1234」：轉大寫、去空白、英文和數字中間補連字號 */
export function normalizePlate(text) {
  let plate = String(text ?? '').toUpperCase().replace(/[^A-Z0-9-]/g, '');
  if (/^[A-Z]{2,4}\d{2,4}$/.test(plate)) plate = plate.replace(/^([A-Z]+)(\d+)$/, '$1-$2');
  else if (/^\d{2,4}[A-Z]{2,4}$/.test(plate)) plate = plate.replace(/^(\d+)([A-Z]+)$/, '$1-$2');
  return plate.slice(0, 10);
}

function element(tag, attributes = {}, text = '') {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attributes)) el.setAttribute(key, value);
  if (text) el.textContent = text;
  return el;
}

/**
 * @param {HTMLElement} root 放表單的容器（需要有 id）
 * @param {{ readOnly?: boolean, onPlateInput?: (plate: string) => void, onQuery?: () => void, onPay?: () => void }} options
 */
export function createParkingForm(root, { readOnly = false, onPlateInput, onQuery, onPay } = {}) {
  const id = (name) => `${root.id}-${name}`;

  const steps = element('ol', { class: 'steps', 'aria-label': '步驟' });
  const stepItems = STEPS.map((name, i) => {
    const item = element('li', {}, `${i + 1}. ${name}`);
    steps.append(item);
    return item;
  });

  const label = element('label', { for: id('plate') }, '車牌');
  const plate = element('input', {
    id: id('plate'),
    type: 'text',
    autocomplete: 'off',
    autocapitalize: 'characters',
    placeholder: '例如 ABC-1234',
    maxlength: '10',
  });
  if (readOnly) {
    plate.readOnly = true;
    plate.setAttribute('aria-readonly', 'true');
  }

  const amountText = element('strong', {}, '—');
  const amount = element('p', { class: 'amount' }, '待繳金額：');
  amount.append(amountText);

  const query = element('button', { type: 'button', class: 'btn btn-secondary' }, '查詢金額');
  const pay = element('button', { type: 'button', class: 'btn btn-primary' }, '付款');
  pay.disabled = true;

  const note = element('p', { class: 'muted small' }, '模擬資料，不會真的扣款。');

  const field = element('div', { class: 'field' });
  field.append(label, plate);
  root.replaceChildren(steps, field, amount);
  if (!readOnly) {
    root.append(query, pay);
    plate.addEventListener('input', () => onPlateInput?.(normalizePlate(plate.value)));
    plate.addEventListener('blur', () => (plate.value = normalizePlate(plate.value)));
    query.addEventListener('click', () => onQuery?.());
    pay.addEventListener('click', () => onPay?.());
  }
  root.append(note);

  return {
    setStep(step) {
      stepItems.forEach((item, i) => {
        const current = i + 1 === step;
        item.classList.toggle('current', current);
        item.classList.toggle('done', i + 1 < step);
        if (current) item.setAttribute('aria-current', 'step');
        else item.removeAttribute('aria-current');
      });
    },
    setFields({ plate: plateValue, amount: amountValue } = {}) {
      if (plateValue !== undefined) plate.value = plateValue;
      amountText.textContent = amountValue === undefined || amountValue === null ? '—' : `${amountValue} 元`;
    },
    getPlate: () => normalizePlate(plate.value),
    setPayEnabled(enabled) {
      pay.disabled = !enabled;
    },
    setPayLabel(text) {
      pay.textContent = text;
    },
    setBusy(busy) {
      query.disabled = busy;
      plate.disabled = busy && !readOnly;
    },
    focusPlate: () => plate.focus(),
  };
}
