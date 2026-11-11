import type { ChatMessage, AnswerPlan } from './contract';
import type { ForecastResult, Affordability } from '../types';

export type Purchase = { price: number; monthsAhead: number };
export type PlanningContext = {
  forecast: ForecastResult;
  purchase: Purchase | null;
  affordability: { status: 'ready'; result: Affordability } | { status: 'insufficient_history' | 'insufficient_information'; guidance: string } | null;
};
const pkr = (value: number) => `PKR ${value.toLocaleString('en-US')}`;
export function planningIntent(messages: ChatMessage[]) {
  const question = messages.at(-1)!.content.toLowerCase();
  const followup = /\b(what if|wait|delay|in \d+ months?)\b/.test(question);
  const prior = [...messages.slice(0, -1)].reverse().find(m => m.role === 'user' && /\b(afford|purchase|buy)\b/i.test(m.content));
  const affordability = /\b(afford|purchase|buy|safely spend|emergenc|risky)\b/.test(question) || (followup && !!prior);
  const forecast = /\bforecast|\bexpected|\bnext month|\bexpenses look|\bpredicted|\breliable/.test(question);
  const amount = (s: string) => {
    const matches = [...s.matchAll(/(?:pkr\s*|rs\.?\s*)(\d[\d,]*(?:\.\d+)?)(?![\w,]|\.\d)|(?:afford|purchase of|buy for)\s+(\d[\d,]*(?:\.\d+)?)(?![\w,]|\.\d)/gi)];
    if (!matches.length) return undefined;
    if (matches.length !== 1) return NaN;
    const raw = matches[0][1] ?? matches[0][2];
    if (!/^(?:\d+|\d{1,3}(?:,\d{3})+)$/.test(raw)) return NaN;
    return Number(raw.replaceAll(',', ''));
  };
  const price = amount(question) ?? (followup && prior ? amount(prior.content) : undefined);
  const horizon = question.match(/\b(?:in|wait|after|delay(?: by)?)\s+(\d+|one|two|three)\s+months?\b/);
  const monthsAhead = /\b(now|immediate|today)\b/.test(question) ? 0 : /\bnext month\b/.test(question) ? 1 : horizon ? Number(({ one: 1, two: 2, three: 3 } as Record<string, number>)[horizon[1]] ?? horizon[1]) : undefined;
  const invalid = price !== undefined && (!Number.isSafeInteger(price) || price <= 0 || price > 2_147_483_647);
  const clarification = invalid ? 'Enter a positive whole-PKR purchase amount up to PKR 2,147,483,647.'
    : monthsAhead !== undefined && (!Number.isSafeInteger(monthsAhead) || monthsAhead < 1 || monthsAhead > 120)
      ? 'Purchase planning supports whole horizons from 1 to 120 months. Immediate purchases (zero months) are not supported by the current calculation.'
      : price === undefined ? 'What is the purchase amount in PKR?'
      : monthsAhead === undefined ? 'In how many months do you plan to make this purchase (1 to 120)?' : null;
  return { affordability, forecast, clarification, purchase: clarification ? null : { price: price!, monthsAhead: monthsAhead! } };
}

export function planningAnswer(messages: ChatMessage[], context: PlanningContext | undefined, previousExpense: number): AnswerPlan | null {
  const intent = planningIntent(messages);
  if (!intent.affordability && !intent.forecast) return null;
  if (/\b(other|another) (user|person)|\b(loan|credit|investment|installment)\b/i.test(messages.at(-1)!.content)) return null;
  const sentences: Record<string, string> = {};
  const plan = () => ({ required: Object.keys(sentences), sentences });
  if (!intent.affordability && /\b(income|salary|savings)\b/i.test(messages.at(-1)!.content)) {
    sentences.answer = 'The existing forecast estimates expenses. Income and savings forecasts are not supported.';
    return plan();
  }
  if (!intent.affordability && /\bnext (year|week)|\bin \d+ months?|\b20\d{2}\b/i.test(messages.at(-1)!.content)) {
    sentences.answer = 'I can explain the existing monthly forecast; forecasts for a specific future year, week or multi-month horizon are not supported.';
    return plan();
  }
  if (intent.affordability && intent.clarification) {
    sentences.answer = /\bemergenc/.test(messages.at(-1)!.content.toLowerCase())
      ? 'The emergency buffer is the greater of your profile emergency target and three times average spending across the qualifying complete months. ' + intent.clarification
      : intent.clarification;
    sentences.coverage = 'I can explain local purchase planning and its emergency buffer once the amount and horizon are provided.';
    return plan();
  }
  if (!context) {
    sentences.answer = 'Planning information is unavailable. Check Financial Planning and try again.';
    return plan();
  }
  const forecast = context.forecast;
  if (intent.affordability) {
    const assessment = context.affordability;
    if (!assessment || JSON.stringify(context.purchase) !== JSON.stringify(intent.purchase)) {
      sentences.answer = 'Purchase information is unavailable. Check Financial Planning and try again.';
    } else if (assessment.status !== 'ready') {
      sentences.answer = assessment.guidance;
      sentences.coverage = 'No affordability conclusion is available; missing information is not confirmed money.';
    } else {
      const result = assessment.result;
      sentences.answer = `For a purchase of ${pkr(intent.purchase!.price)} in ${intent.purchase!.monthsAhead} months: ${result.reason} Projected funds available after reserving the buffer: ${pkr(result.available)}. Remaining after purchase: ${pkr(result.remainingAfterPurchase)}. Shortfall: ${pkr(result.shortfall)}.`;
      sentences.buffer = `Keep aside ${pkr(result.buffer)} for emergencies. The existing buffer is the greater of your profile emergency target and three times average monthly spending across the qualifying complete months.`;
      sentences.coverage = 'This is an estimate using active checking and savings balances and nonnegative average monthly savings; transfers are excluded from income and expenses. Future savings and costs are not guaranteed.';
    }
    return plan();
  }
  if (forecast.status !== 'ready') {
    sentences.answer = `Forecast unavailable (${forecast.reason}): ${forecast.guidance}`;
    sentences.coverage = `${forecast.availableCompleteMonths} of 3 preceding complete Karachi calendar months qualify. The current partial month is excluded. Missing or unconfirmed history is not zero spending.`;
  } else {
    const f = forecast.forecast;
    sentences.answer = `The forecast estimates monthly expenses of ${pkr(f.total.blend)}, with an estimated range of ${pkr(f.total.low)} to ${pkr(f.total.high)}. Recent recorded spending in the previous calendar month was ${pkr(previousExpense)}.`;
    const categories = Object.entries(f.byCategory).sort(([a, x], [b, y]) => y.blend - x.blend || a.localeCompare(b));
    sentences.categories = categories.length ? `Forecast categories (up to 10), highest estimate first: ${categories.slice(0, 10).map(([name, value]) => `${JSON.stringify(name)}: ${pkr(value.blend)}`).join('; ')}.` : 'There are no forecast categories to rank.';
    sentences.coverage = `Based on complete Karachi months ${forecast.qualifyingMonths.join(', ')}; eligible empty months count as zero. The current partial month is excluded. Method: ${f.method}. The range describes an estimate, not a calibrated probability or guaranteed outcome.`;
  }
  return plan();
}

// Validate the exact aggregate wire shape; reject identifiers and extra private fields.
export function parsePlanning(value: unknown): PlanningContext {
  const object = (v: unknown, names: string[]) => {
    if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('Invalid planning context.');
    const r = v as Record<string, unknown>;
    if (Object.keys(r).some(k => !names.includes(k)) || names.some(k => !(k in r))) throw new Error('Invalid planning fields.');
    return r;
  };
  const number = (v: unknown) => { if (typeof v !== 'number' || !Number.isSafeInteger(v)) throw new Error('Invalid planning amount.'); return v; };
  const string = (v: unknown) => { if (typeof v !== 'string' || !v || v.length > 2000) throw new Error('Invalid planning text.'); return v; };
  const root = object(value, ['forecast', 'purchase', 'affordability']);
  const raw = root.forecast as Record<string, unknown>;
  const f = object(raw, ['status', 'forecast', 'requiredCompleteMonths', 'availableCompleteMonths', 'qualifyingMonths', 'guidance', ...(raw?.status === 'insufficient_history' ? ['reason'] : [])]);
  if (f.requiredCompleteMonths !== 3 || number(f.availableCompleteMonths) < 0 || number(f.availableCompleteMonths) > 3) throw new Error('Invalid readiness.');
  string(f.guidance);
  if (!Array.isArray(f.qualifyingMonths) || f.qualifyingMonths.length !== f.availableCompleteMonths || f.qualifyingMonths.some(m => typeof m !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(m))) throw new Error('Invalid qualifying months.');
  if (f.status === 'ready') {
    if (f.availableCompleteMonths !== 3) throw new Error('Invalid readiness.');
    const data = object(f.forecast, ['total', 'byCategory', 'method', 'asOf']);
    const range = (v: unknown) => {
      const r = object(v, ['blend', 'low', 'high']);
      if (number(r.low) < 0 || number(r.blend) < number(r.low) || number(r.high) < number(r.blend)) throw new Error('Invalid forecast range.');
    };
    range(data.total); string(data.method); string(data.asOf);
    if (!data.byCategory || typeof data.byCategory !== 'object' || Array.isArray(data.byCategory) || Object.keys(data.byCategory).length > 200) throw new Error('Invalid categories.');
    for (const [name, values] of Object.entries(data.byCategory)) { string(name); range(values); }
  } else if (f.status !== 'insufficient_history' || f.forecast !== null || !['history_start_unconfirmed', 'insufficient_complete_months', 'invalid_history_start'].includes(String(f.reason))) throw new Error('Invalid forecast.');
  if (root.purchase !== null) {
    const p = object(root.purchase, ['price', 'monthsAhead']);
    if (number(p.price) <= 0 || number(p.price) > 2_147_483_647 || number(p.monthsAhead) < 1 || number(p.monthsAhead) > 120) throw new Error('Invalid purchase.');
  }
  if (root.affordability !== null) {
    const a = root.affordability as Record<string, unknown>;
    if (a.status === 'ready') {
      object(a, ['status', 'result']);
      const r = object(a.result, ['canAfford', 'available', 'buffer', 'remainingAfterPurchase', 'shortfall', 'monthsNeededAtCurrentRate', 'reason']);
      for (const key of ['available', 'buffer', 'remainingAfterPurchase', 'shortfall', 'monthsNeededAtCurrentRate']) number(r[key]);
      if (typeof r.canAfford !== 'boolean' || !root.purchase || f.status !== 'ready' || number(r.buffer) < 0 || number(r.shortfall) < 0) throw new Error('Invalid assessment.');
      string(r.reason);
    } else {
      object(a, ['status', 'guidance']); string(a.guidance);
      if (!['insufficient_history', 'insufficient_information'].includes(String(a.status))) throw new Error('Invalid assessment.');
    }
  }
  return value as PlanningContext;
}
