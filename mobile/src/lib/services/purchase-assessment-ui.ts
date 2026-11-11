import type { AffordabilityAssessment } from '../types';
import { parsePkrAmount } from '../validation/transaction';
import { parsePlanningHorizon } from '../validation/affordability';
export type PurchaseDraft = { itemName: string; price: string; monthsAhead: string };
export type PurchaseAssessmentState = { checking: boolean; error: string | null; result: { itemName: string; assessment: AffordabilityAssessment } | null };
export function createPurchaseAssessmentController(dependencies: {
  assess: (input: { itemName: string; price: number; monthsAhead: number }) => Promise<AffordabilityAssessment>;
  changed: (state: PurchaseAssessmentState) => void;
}) {
  let generation = 0;
  let state: PurchaseAssessmentState = { checking: false, error: null, result: null };
  const publish = (patch: Partial<PurchaseAssessmentState>) => { state = { ...state, ...patch }; dependencies.changed(state); };
  function invalidate() { generation++; publish({ checking: false, error: null, result: null }); }
  async function check(draft: PurchaseDraft) {
    if (state.checking) return;
    const request = ++generation;
    publish({ checking: true, error: null, result: null });
    try {
      let input;
      try {
        const itemName = draft.itemName.trim(); if (!itemName) throw new Error('Enter the purchase name.');
        input = { itemName, price: parsePkrAmount(draft.price), monthsAhead: parsePlanningHorizon(draft.monthsAhead) };
      } catch (error) { if (request === generation) publish({ error: error instanceof Error ? error.message : 'Check the purchase inputs.' }); return; }
      try {
        const assessment = await dependencies.assess(input);
        if (request === generation) publish({ result: { itemName: input.itemName, assessment } });
      } catch { if (request === generation) publish({ error: 'Purchase assessment could not be verified. Refresh Planning and try again.' }); }
    } finally { if (request === generation) publish({ checking: false }); }
  }
  return { check, invalidate, getState: () => state };
}
