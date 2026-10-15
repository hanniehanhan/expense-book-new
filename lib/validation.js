export const categories = ['식비', '카페·간식', '교통', '쇼핑', '생활', '주거·통신', '건강', '문화·여가', '기타'];
export function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return value >= '1900-01-01' && value <= '9999-12-31' && !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}
export function validMonth(value) { return typeof value === 'string' && /^\d{4}-\d{2}$/.test(value) && validDate(`${value}-01`); }
export function expenseInput(body) {
  const { date, category, amount } = body ?? {};
  const title = typeof body?.title === 'string' ? body.title.trim() : '';
  if (!validDate(date)) throw new Error('올바른 날짜를 입력해 주세요.');
  if (!title || title.length > 100) throw new Error('항목은 1~100자로 입력해 주세요.');
  if (!categories.includes(category)) throw new Error('카테고리를 선택해 주세요.');
  if (!Number.isSafeInteger(amount) || amount < 1 || amount > 999999999) throw new Error('금액은 1~999,999,999원의 정수로 입력해 주세요.');
  return { date, title, category, amount };
}
