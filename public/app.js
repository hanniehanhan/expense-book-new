const $ = selector => document.querySelector(selector);
const money = value => Number(value).toLocaleString('ko-KR');
const today = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const categories = ['식비', '카페·간식', '교통', '쇼핑', '생활', '주거·통신', '건강', '문화·여가', '기타'];
const colors = ['#668463', '#b0a27e', '#8b9fac', '#b78b80', '#94a67e', '#9c92ab', '#86aaa1', '#c3ab73', '#a0a69a'];
let rows = [], editingId = null, deletingId = null, loadVersion = 0, toastTimer, saving = false;
$('#month').value = today().slice(0, 7);
for (const category of categories) $('#expense-category').add(new Option(category, category));

async function api(path, options = {}) {
  const response = await fetch(`/api${path}`, { ...options, headers: { 'Content-Type': 'application/json', 'X-Moa-Request': '1', ...options.headers }, credentials: 'same-origin' });
  const data = response.status === 204 ? null : await response.json();
  if (!response.ok) {
    if (response.status === 401 && path !== '/login') showLogin();
    throw new Error(data?.error || '요청에 실패했습니다. 다시 시도해 주세요.');
  }
  return data;
}
function showLogin() {
  ++loadVersion;
  $('#app-view').hidden = true;
  $('#login-view').hidden = false;
  for (const dialog of document.querySelectorAll('dialog[open]')) dialog.close();
  rows = [];
  $('#expense-list').replaceChildren();
  $('#category-chart').replaceChildren();
  $('#password').value = '';
}
function showApp() {
  $('#login-view').hidden = true;
  $('#app-view').hidden = false;
  $('#password').value = '';
  load();
}
function toast(message) {
  clearTimeout(toastTimer);
  $('#toast').textContent = message;
  $('#toast').hidden = false;
  toastTimer = setTimeout(() => { $('#toast').hidden = true; }, 3500);
}
function node(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}
function setStat(selector, value, unit) {
  $(selector).replaceChildren(document.createTextNode(value), node('small', '', unit));
}
function renderSummary(summary) {
  setStat('#total', money(summary.total), '원');
  setStat('#count', money(summary.count), '건');
  $('#total-note').textContent = `${Number($('#month').value.slice(5))}월의 소비를 차곡차곡 모았어요`;
  const top = summary.categories[0];
  $('#top-category').textContent = top?.category || '아직 없어요';
  $('#top-note').textContent = top ? `${money(top.total)}원 · 전체 지출의 ${Math.round(top.total / summary.total * 100)}%` : '첫 지출을 기록하면 여기에 보여요';
  const chart = $('#category-chart');
  chart.replaceChildren();
  if (!summary.categories.length) chart.append(node('div', 'chart-empty', '기록이 쌓이면 소비의 흐름이 보여요.\n첫 지출을 기록해 보세요.'));
  for (const item of summary.categories) {
    const color = colors[Math.max(0, categories.indexOf(item.category))];
    const percent = Math.round(item.total / summary.total * 100);
    const row = node('div', 'chart-row');
    const label = node('div', 'chart-label');
    const title = node('span');
    const dot = node('i'); dot.style.backgroundColor = color;
    title.append(dot, document.createTextNode(item.category));
    const total = node('b', '', `${money(item.total)}원`); total.append(node('small', '', `${percent}%`));
    label.append(title, total);
    const track = node('div', 'bar-track');
    track.setAttribute('role', 'img'); track.setAttribute('aria-label', `${item.category}: ${money(item.total)}원, 전체의 ${percent}%`);
    const bar = node('div', 'bar-fill'); bar.style.width = `${item.total / summary.total * 100}%`; bar.style.backgroundColor = color;
    track.append(bar); row.append(label, track); chart.append(row);
  }
}
function renderRows() {
  const tbody = $('#expense-list'); tbody.replaceChildren();
  $('#list-count').textContent = rows.length;
  const filtered = Boolean($('#date-filter').value);
  $('#empty-state').hidden = rows.length > 0;
  $('#empty-state h3').textContent = filtered ? '이 날짜에는 기록된 지출이 없어요' : '아직 기록된 지출이 없어요';
  $('#empty-state p').textContent = filtered ? '다른 날짜를 선택하거나 전체 내역을 확인해 보세요.' : '오늘의 작은 소비부터 기록해 보세요.';
  $('#filter-caption').textContent = filtered ? '선택한 날짜 내역' : '이번 달 전체 내역';
  $('#filtered-total').textContent = `${filtered ? '검색' : '목록'} 합계 ${money(rows.reduce((sum, row) => sum + row.amount, 0))}원`;
  $('#list-description').textContent = `${money(rows.length)}건 · 최신 날짜순`;
  for (const row of rows) {
    const tr = node('tr');
    tr.append(node('td', '', `${row.date.slice(5, 7)}.${row.date.slice(8)} ${new Intl.DateTimeFormat('ko-KR', { weekday: 'short', timeZone: 'UTC' }).format(new Date(`${row.date}T00:00:00Z`))}`), node('td', '', row.title));
    const cell = node('td'); const pill = node('span', 'category-pill', row.category);
    const color = colors[Math.max(0, categories.indexOf(row.category))]; pill.style.backgroundColor = `${color}18`; pill.style.color = color;
    cell.append(pill); tr.append(cell, node('td', 'amount-cell', `${money(row.amount)}원`));
    const actionCell = node('td'), actions = node('div', 'row-actions');
    for (const [action, symbol, label] of [['edit', '✎', '수정'], ['delete', '×', '삭제']]) {
      const button = node('button', 'icon-button', symbol); button.dataset.action = action; button.dataset.id = row.id;
      button.setAttribute('aria-label', `${row.title} ${label}`); button.title = label; actions.append(button);
    }
    actionCell.append(actions); tr.append(actionCell); tbody.append(tr);
  }
}
async function load() {
  const version = ++loadVersion;
  const month = $('#month').value;
  if (!month) return;
  $('#month-display').textContent = `${Number(month.slice(0, 4))}년 ${Number(month.slice(5))}월`;
  const date = $('#date-filter').value;
  $('#load-error').hidden = true;
  $('#refresh').disabled = true;
  $('#list-description').textContent = '내역을 불러오는 중이에요…';
  $('#expense-list').replaceChildren();
  $('#empty-state').hidden = true;
  $('#filtered-total').textContent = '';
  $('#list-count').textContent = '—';
  for (const key of ['#total', '#count', '#top-category']) $(key).textContent = '—';
  $('#top-note').textContent = '지출을 불러오는 중이에요';
  $('#category-chart').replaceChildren(node('div', 'chart-empty', '소비 기록을 불러오는 중이에요…'));
  rows = [];
  try {
    const [data, summary] = await Promise.all([api(`/expenses?month=${month}${date ? `&date=${date}` : ''}`), api(`/summary?month=${month}`)]);
    if (version !== loadVersion) return;
    rows = data.expenses; renderRows(); renderSummary(summary);
  } catch (error) {
    if (version !== loadVersion) return;
    $('#load-error span').textContent = error.message; $('#load-error').hidden = false;
    $('#list-description').textContent = '내역을 불러오지 못했어요';
    $('#category-chart').replaceChildren(node('div', 'chart-empty', '연결 상태를 확인한 후 다시 시도해 주세요.'));
    $('#top-note').textContent = '연결 상태를 확인해 주세요';
  } finally { if (version === loadVersion) $('#refresh').disabled = false; }
}
$('#login-form').addEventListener('submit', async event => {
  event.preventDefault(); const button = event.submitter; button.disabled = true;
  $('#login-error').textContent = '';
  try { await api('/login', { method: 'POST', body: JSON.stringify({ password: $('#password').value }) }); showApp(); }
  catch (error) { $('#login-error').textContent = error.message; }
  finally { button.disabled = false; }
});
$('#logout').addEventListener('click', async () => {
  try { await api('/logout', { method: 'POST', body: '{}' }); showLogin(); }
  catch (error) { toast(error.message); }
});
function changeMonth(value) {
  $('#month').value = value; $('#date-filter').value = ''; load();
}
function stepMonth(step) {
  const [year, month] = $('#month').value.split('-').map(Number);
  const value = new Date(Date.UTC(year, month - 1 + step, 1)).toISOString().slice(0, 7);
  if (value >= '1900-01' && value <= '9999-12') changeMonth(value);
}
$('#prev-month').addEventListener('click', () => stepMonth(-1));
$('#next-month').addEventListener('click', () => stepMonth(1));
$('#this-month').addEventListener('click', () => changeMonth(today().slice(0, 7)));
$('#month').addEventListener('change', () => { if ($('#month').value && $('#month').checkValidity()) changeMonth($('#month').value); });
$('#date-filter').addEventListener('change', () => {
  if (!$('#date-filter').checkValidity()) return;
  const date = $('#date-filter').value; if (date) $('#month').value = date.slice(0, 7); load();
});
$('#clear-filter').addEventListener('click', () => { $('#date-filter').value = ''; load(); });
for (const id of ['#refresh', '#retry']) $(id).addEventListener('click', load);
function openExpense(row) {
  editingId = row?.id || null;
  $('#expense-form').reset();
  $('#dialog-title').textContent = row ? '지출 수정하기' : '지출 기록하기';
  $('#expense-date').value = row?.date || $('#date-filter').value || (today().startsWith($('#month').value) ? today() : `${$('#month').value}-01`);
  $('#expense-title').value = row?.title || '';
  $('#expense-category').value = row?.category || categories[0];
  $('#expense-amount').value = row?.amount || '';
  $('#expense-error').textContent = '';
  $('#expense-dialog').showModal();
}
for (const id of ['#add-expense', '#empty-add']) $(id).addEventListener('click', () => openExpense());
for (const id of ['#close-dialog', '#cancel-dialog']) $(id).addEventListener('click', () => { if (!saving) $('#expense-dialog').close(); });
$('#expense-dialog').addEventListener('cancel', event => { if (saving) event.preventDefault(); });
$('#expense-form').addEventListener('submit', async event => {
  event.preventDefault(); if (saving) return;
  saving = true; $('#save-expense').disabled = true; $('#expense-error').textContent = '';
  const data = { date: $('#expense-date').value, title: $('#expense-title').value.trim(), category: $('#expense-category').value, amount: Number($('#expense-amount').value) };
  try {
    await api(editingId ? `/expenses/${editingId}` : '/expenses', { method: editingId ? 'PUT' : 'POST', body: JSON.stringify(data) });
    $('#expense-dialog').close(); toast(editingId ? '지출 내역을 수정했어요.' : '새로운 지출을 기록했어요.');
    $('#month').value = data.date.slice(0, 7);
    if ($('#date-filter').value && $('#date-filter').value !== data.date) $('#date-filter').value = '';
    load();
  } catch (error) { $('#expense-error').textContent = error.message; }
  finally { saving = false; $('#save-expense').disabled = false; }
});
$('#expense-list').addEventListener('click', event => {
  const button = event.target.closest('button[data-action]'); if (!button) return;
  const row = rows.find(item => item.id === button.dataset.id); if (!row) return;
  if (button.dataset.action === 'edit') openExpense(row);
  else {
    deletingId = row.id; $('#delete-description').textContent = `${row.title} · ${money(row.amount)}원`;
    $('#delete-error').textContent = ''; $('#delete-dialog').showModal();
  }
});
$('#cancel-delete').addEventListener('click', () => { if (!saving) $('#delete-dialog').close(); });
$('#delete-dialog').addEventListener('cancel', event => { if (saving) event.preventDefault(); });
$('#delete-form').addEventListener('submit', async event => {
  event.preventDefault(); if (saving) return;
  saving = true; const button = event.submitter; button.disabled = true;
  try { await api(`/expenses/${deletingId}`, { method: 'DELETE', body: '{}' }); $('#delete-dialog').close(); toast('지출 내역을 삭제했어요.'); load(); }
  catch (error) { $('#delete-error').textContent = error.message; }
  finally { saving = false; button.disabled = false; }
});
(async () => {
  try {
    const health = await api('/health');
    if (!health.configured) { $('#login-error').textContent = '서버 설정이 필요합니다. .env에 DATABASE_URL과 12자 이상의 APP_PASSWORD를 설정해 주세요.'; return; }
    const response = await fetch('/api/session', { credentials: 'same-origin' });
    if (response.ok) showApp();
  } catch { $('#login-error').textContent = '서버에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요.'; }
})();
