// Dependency-free wire contract shared with the mobile-only server handler.
export const CHAT_VERSION = 1;
export const MAX_CHAT_MESSAGES = 12;
export type ChatMessage = { role: 'user' | 'assistant'; content: string };
export type Period = {
  month: string;
  start: string;
  endExclusive: string;
  through: string;
  coverage: 'complete' | 'partial' | 'unconfirmed' | 'unavailable';
  income: number;
  expense: number;
  savings: number;
  categories: { name: string; total: number }[];
};
export type FinancialContext = {
  source: 'mobile_sqlite';
  asOf: string;
  timeZone: 'Asia/Karachi';
  history: { status: 'confirmed' | 'unconfirmed' | 'unavailable'; startedAt: string | null };
  forecast: { status: 'ready' | 'insufficient_history'; availableCompleteMonths: number; requiredCompleteMonths: 3 };
  balances: { total: number; accountCount: number; basis: 'current_stored_balance' };
  current: Period;
  previous: Period;
};
export type ChatRequest = { version: 1; messages: ChatMessage[]; context: FinancialContext };
export type ChatResponse = { version: 1; text: string; source: 'mobile_sqlite'; mode: 'model_selected' | 'deterministic'; asOf: string };

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid chat contract.');
  return value as Record<string, unknown>;
}
function keys(row: Record<string, unknown>, allowed: string[]) {
  if (Object.keys(row).some((key) => !allowed.includes(key))) throw new Error('Invalid chat contract.');
}
function money(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) throw new Error('Invalid financial amount.');
  return value;
}
function instant(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
    || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) throw new Error('Invalid reporting date.');
  return value;
}
function text(value: unknown, maximum: number): string {
  if (typeof value !== 'string' || !value.trim() || value.length > maximum) throw new Error('Invalid chat text.');
  return value;
}
function choice<T extends string>(value: unknown, values: readonly T[]): T {
  if (!values.includes(value as T)) throw new Error('Invalid chat contract.');
  return value as T;
}
function parsePeriod(value: unknown): Period {
  const row = record(value);
  keys(row, ['month', 'start', 'endExclusive', 'through', 'coverage', 'income', 'expense', 'savings', 'categories']);
  const month = text(row.month, 7);
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error('Invalid reporting month.');
  const start = instant(row.start), endExclusive = instant(row.endExclusive), through = instant(row.through);
  const next = new Date(`${month}-01T00:00:00.000Z`);
  next.setUTCMonth(next.getUTCMonth() + 1);
  const localBoundary = (date: string, expectedMonth: string) => {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Karachi', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(date));
    const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    return `${values.year}-${values.month}` === expectedMonth && values.day === '01'
      && values.hour === '00' && values.minute === '00' && values.second === '00' && date.endsWith('.000Z');
  };
  if (!localBoundary(start, month) || !localBoundary(endExclusive, next.toISOString().slice(0, 7)) || through < start || through >= endExclusive) {
    throw new Error('Invalid reporting boundaries.');
  }
  const income = money(row.income), expense = money(row.expense), savings = money(row.savings);
  if (income < 0 || expense < 0 || money(income - expense) !== savings) throw new Error('Inconsistent financial totals.');
  if (!Array.isArray(row.categories) || row.categories.length > 200) throw new Error('Invalid category totals.');
  const categories = row.categories.map((item) => {
    const category = record(item);
    keys(category, ['name', 'total']);
    const name = text(category.name, 100), total = money(category.total);
    if (total <= 0 || /[\u0000-\u001f\u007f]/.test(name)) throw new Error('Invalid category total.');
    return { name, total };
  });
  if (new Set(categories.map((item) => item.name)).size !== categories.length
    || categories.reduce((sum, item) => money(sum + item.total), 0) !== expense) throw new Error('Inconsistent categories.');
  return { month, start, endExclusive, through, income, expense, savings, categories,
    coverage: choice(row.coverage, ['complete', 'partial', 'unconfirmed', 'unavailable']) };
}

export function parseChatRequest(value: unknown): ChatRequest {
  const row = record(value);
  keys(row, ['version', 'messages', 'context']);
  if (row.version !== CHAT_VERSION || !Array.isArray(row.messages) || !row.messages.length || row.messages.length > MAX_CHAT_MESSAGES) throw new Error('Invalid chat request.');
  const messages = row.messages.map((item): ChatMessage => {
    const message = record(item);
    keys(message, ['role', 'content']);
    return { role: choice(message.role, ['user', 'assistant']), content: text(message.content, 2000) };
  });
  if (messages.at(-1)?.role !== 'user') throw new Error('A question is required.');
  const ctx = record(row.context);
  keys(ctx, ['source', 'asOf', 'timeZone', 'history', 'forecast', 'balances', 'current', 'previous']);
  if (ctx.source !== 'mobile_sqlite' || ctx.timeZone !== 'Asia/Karachi') throw new Error('Mobile context is required.');
  const asOf = instant(ctx.asOf);
  const historyRow = record(ctx.history);
  keys(historyRow, ['status', 'startedAt']);
  const history: FinancialContext['history'] = {
    status: choice(historyRow.status, ['confirmed', 'unconfirmed', 'unavailable']),
    startedAt: historyRow.startedAt === null ? null : instant(historyRow.startedAt),
  };
  if ((history.status === 'confirmed') !== (history.startedAt !== null) || (history.startedAt && history.startedAt > asOf)) throw new Error('Invalid history state.');
  const forecastRow = record(ctx.forecast);
  keys(forecastRow, ['status', 'availableCompleteMonths', 'requiredCompleteMonths']);
  const forecast: FinancialContext['forecast'] = {
    status: choice(forecastRow.status, ['ready', 'insufficient_history']),
    availableCompleteMonths: money(forecastRow.availableCompleteMonths), requiredCompleteMonths: 3,
  };
  if (forecastRow.requiredCompleteMonths !== 3 || forecast.availableCompleteMonths < 0 || forecast.availableCompleteMonths > 3
    || (forecast.status === 'ready' && (forecast.availableCompleteMonths !== 3 || history.status !== 'confirmed'))) throw new Error('Invalid forecast state.');
  const balanceRow = record(ctx.balances);
  keys(balanceRow, ['total', 'accountCount', 'basis']);
  const balances: FinancialContext['balances'] = {
    total: money(balanceRow.total), accountCount: money(balanceRow.accountCount),
    basis: choice(balanceRow.basis, ['current_stored_balance']),
  };
  if (balances.accountCount < 0 || (!balances.accountCount && balances.total !== 0)) throw new Error('Invalid account state.');
  const current = parsePeriod(ctx.current), previous = parsePeriod(ctx.previous);
  if (current.through !== asOf || current.start > asOf || current.endExclusive <= asOf || previous.endExclusive !== current.start
    || previous.through !== new Date(Date.parse(previous.endExclusive) - 1).toISOString()) throw new Error('Inconsistent periods.');
  for (const period of [current, previous]) {
    const expected = history.status === 'confirmed'
      ? (history.startedAt! <= period.start ? 'complete' : 'partial')
      : history.status;
    if (period.coverage !== expected) throw new Error('Inconsistent history coverage.');
  }
  return { version: 1, messages, context: { source: 'mobile_sqlite', asOf, timeZone: 'Asia/Karachi', history, forecast, balances, current, previous } };
}

export function recentMessages(messages: ChatMessage[]): ChatMessage[] {
  return messages.slice(-MAX_CHAT_MESSAGES).map(({ role, content }) => ({ role, content: content.slice(0, 2000) }));
}

export type AnswerPlan = { required: string[]; sentences: Record<string, string> };
const pkr = (amount: number) => `PKR ${amount.toLocaleString('en-US')}`;
const displayCategory = (name: string) => JSON.stringify(name.replaceAll('_', ' '));

export function buildAnswerPlan(request: ChatRequest): AnswerPlan {
  const { current, previous } = request.context;
  const question = request.messages.at(-1)!.content.toLowerCase();
  const compare = /\bcompar|\bversus\b|\bvs\b|\bchange\b|\bdifference\b/.test(question);
  const lastMonth = /\blast month\b|\bprevious month\b|\bprevious complete month\b/.test(question);
  const period = lastMonth && !compare ? previous : current;
  const label = `${period.month} (${period === current ? 'month to date, through ' + period.through : 'complete calendar month'}; Asia/Karachi)`;
  const required = ['answer', 'coverage'];
  const sentences: Record<string, string> = {};
  const eligibleQuestion = /\b(spend|spent|spending|expense|expenses|income|receive|received|earn|earned|save|saved|savings|categor|groceries)\b/.test(question)
    || question.includes('category') || question.includes('categories');
  const unsupportedPeriod = /\b(last|this|next) (week|year|day)\b|\byesterday\b|\btoday\b|\b20\d{2}\b|\b(january|february|march|april|may|june|july|august|september|october|november|december)\b|\b\d+ months?\b/.test(question);
  const unsafeScope = /\b(other|another) (user|person)|\bforecast|\bafford|\binstallment|\bbalance|\btransactions?\b|\b(excluding|except|without|before|after|since|between|refunds?)\b/.test(question)
    || (compare && /\bgrocer|\bcategory\b|\bcategories\b/.test(question));
  if (!eligibleQuestion || unsupportedPeriod || unsafeScope) {
    sentences.answer = 'I can report recorded income, expenses, net savings, category spending, and a comparison of this month to the previous month. Please ask explicitly about this month or last month; other periods and financial advice are not supported here yet.';
    sentences.coverage = 'Only your local recorded aggregates are available to this assistant; no other user or demo ledger is accessible.';
    return { required, sentences };
  }
  if (compare) {
    const delta = current.expense - previous.expense;
    if (!Number.isSafeInteger(delta)) throw new Error('Comparison is outside the supported range.');
    sentences.answer = `Recorded expenses are ${pkr(current.expense)} for ${current.month} month to date through ${current.through}, versus ${pkr(previous.expense)} for the complete calendar month ${previous.month} (Asia/Karachi). The recorded difference is ${pkr(delta)} (current minus previous).`;
    sentences.coverage = 'This compares a partial current month with a full previous month, not equal-duration periods. '
      + coverageText(current, request.context) + ' ' + coverageText(previous, request.context);
  } else if (period.coverage === 'unavailable') {
    sentences.answer = `Financial history is unavailable for ${label}; no complete financial conclusion can be made.`;
    sentences.coverage = coverageText(period, request.context);
  } else if (/\bincome\b|\breceiv|\bearn/.test(question)) {
    sentences.answer = `Recorded income for ${label} is ${pkr(period.income)}.`;
    sentences.calculation = 'Income includes income entries only; transfers between your accounts are excluded.';
  } else if (/\bsav/.test(question)) {
    sentences.answer = `Recorded net savings for ${label} are ${pkr(period.savings)}: income ${pkr(period.income)} minus expenses ${pkr(period.expense)}.`;
    sentences.calculation = 'Net savings are income minus expenses in the same reporting period; moving money between accounts does not create savings.';
  } else if (/\bbiggest\b|\btop\b|\blargest\b/.test(question)) {
    const sorted = [...period.categories].sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
    const top = sorted.filter((item) => item.total === sorted[0]?.total);
    sentences.answer = top.length
      ? `The biggest recorded spending ${top.length > 1 ? 'categories are ' : 'category is '}${top.slice(0, 3).map((item) => displayCategory(item.name)).join(', ')}${top.length > 3 ? ' (examples from tied categories)' : ''} at ${pkr(top[0].total)}${top.length > 1 ? ' each' : ''} for ${label}.`
      : `There are no recorded expenses to rank for ${label}.`;
  } else {
    const mentioned = period.categories.filter((item) => question.includes(item.name.replaceAll('_', ' ').toLowerCase()));
    if (/\bgrocer/.test(question) && !mentioned.some((item) => item.name === 'groceries')) {
      mentioned.push({ name: 'groceries', total: 0 });
    }
    if (mentioned.length) {
      sentences.answer = `Recorded spending for ${label}: ${mentioned.map((item) => `${displayCategory(item.name)} ${pkr(item.total)}`).join('; ')}.`;
    } else if (/\bon\b|\bcategory\b/.test(question)) {
      sentences.answer = `I could not match a recorded spending category for ${label}. Please use an exact category name; an absent category does not establish zero spending in an unrecorded category.`;
    } else {
      sentences.answer = `Recorded expenses for ${label} are ${pkr(period.expense)}.`;
    }
    sentences.calculation = 'Expenses include expense entries only; transfers and entries after the reporting cutoff are excluded.';
  }
  sentences.coverage ??= coverageText(period, request.context);
  return { required, sentences };
}

function coverageText(period: Period, context: FinancialContext) {
  if (!context.balances.accountCount) return 'No local accounts are available; zero recorded amounts are not proof of a complete financial history.';
  if (period.coverage === 'unavailable') return `History for ${period.month} could not be verified. Check Financial Planning before relying on these recorded amounts.`;
  if (period.coverage === 'unconfirmed') return `History completeness for ${period.month} is unconfirmed. These are recorded amounts only; missing entries may change the financial picture. Confirm history in Financial Planning.`;
  if (period.coverage === 'partial') return `History for ${period.month} starts partway through or after this period; these recorded amounts are incomplete.`;
  return `History is confirmed from the start of ${period.month}; ${period === context.current ? 'the current month is still in progress' : 'this is a complete calendar month'}.`;
}

export function renderAnswer(plan: AnswerPlan, selected: string[] = Object.keys(plan.sentences)): string {
  if (new Set(selected).size !== selected.length || selected.some((id) => !Object.hasOwn(plan.sentences, id))
    || plan.required.some((id) => !selected.includes(id))) throw new Error('Unsupported financial response.');
  return selected.map((id) => plan.sentences[id]).join('\n\n');
}

export function parseSelection(raw: string, plan: AnswerPlan): string[] {
  const row = record(JSON.parse(raw));
  keys(row, ['sentenceIds']);
  if (!Array.isArray(row.sentenceIds) || row.sentenceIds.some((id) => typeof id !== 'string')) throw new Error('Unsupported financial response.');
  renderAnswer(plan, row.sentenceIds as string[]);
  return row.sentenceIds as string[];
}

export function parseChatResponse(value: unknown, request: ChatRequest): ChatResponse {
  const row = record(value);
  keys(row, ['version', 'text', 'source', 'mode', 'asOf']);
  const plan = buildAnswerPlan(request);
  const answer = text(row.text, 16000);
  // Accept only a composition of this request's exact authoritative sentences.
  const selected = answer.split('\n\n').map((sentence) => Object.keys(plan.sentences).find((key) => plan.sentences[key] === sentence));
  if (selected.some((id) => !id) || renderAnswer(plan, selected as string[]) !== answer
    || row.version !== 1 || row.source !== 'mobile_sqlite' || row.asOf !== request.context.asOf) throw new Error('Unsupported financial response.');
  return { version: 1, text: answer, source: 'mobile_sqlite', asOf: request.context.asOf,
    mode: choice(row.mode, ['model_selected', 'deterministic']) };
}
