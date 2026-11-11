export const MAX_PLANNING_HORIZON_MONTHS = 120;

const wholeNumberPattern = /^[0-9]+$/;
const horizonError = `Enter a whole number of months from 1 to ${MAX_PLANNING_HORIZON_MONTHS}.`;

export function validatePlanningHorizon(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > MAX_PLANNING_HORIZON_MONTHS) {
    throw new Error(horizonError);
  }
  return value;
}

/** Parses a complete planning horizon without truncating malformed input. */
export function parsePlanningHorizon(raw: string): number {
  if (!wholeNumberPattern.test(raw)) throw new Error(horizonError);
  return validatePlanningHorizon(Number(raw));
}