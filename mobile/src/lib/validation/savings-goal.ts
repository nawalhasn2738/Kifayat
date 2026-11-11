import { parsePkrAmount, MAX_PKR_AMOUNT, isValidTransactionDate } from './transaction';
import { reportingCalendarDate } from '../finance/reporting-calendar';
export { parsePkrAmount as parseGoalTarget };
export function validateGoalTarget(value: number) {
  if (!Number.isSafeInteger(value) || value <= 0 || value > MAX_PKR_AMOUNT) throw new Error('Enter a positive whole-PKR goal target within the supported limit.');
  return value;
}
export function validateGoalCreation(input: { name: string; targetAmount: number; targetDate: string }) {
  const name = input.name?.trim();
  if (!name || name.length > 100 || /[\u0000-\u001f\u007f]/.test(name)) throw new Error('Enter a goal name of 1 to 100 characters.');
  if (!isValidTransactionDate(input.targetDate)) throw new Error('Enter a valid goal date.');
  return { name, targetAmount: validateGoalTarget(input.targetAmount), targetDate: input.targetDate };
}
export function parseGoalDate(raw: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) throw new Error('Enter a target date as YYYY-MM-DD.');
  const date = new Date(`${raw}T00:00:00.000+05:00`);
  if (!Number.isFinite(date.getTime()) || reportingCalendarDate(date) !== raw) throw new Error('Enter a valid Karachi target date.');
  return date.toISOString();
}
