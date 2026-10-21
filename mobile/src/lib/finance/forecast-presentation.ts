import type { Forecast } from '@/lib/types';

export const FORECAST_TOTAL_LABEL = 'ESTIMATED MONTHLY SPENDING (PKR)';
export const FORECAST_CATEGORY_LABEL = 'Estimated monthly spending by category';

export function forecastBasisLabel(qualifyingMonths: string[]) {
  return `Based on complete Karachi months: ${qualifyingMonths.join(', ')}.`;
}


export function forecastCategoryRows(forecast: Forecast) {
  return Object.entries(forecast.byCategory).sort(
    ([leftName, left], [rightName, right]) => right.blend - left.blend || leftName.localeCompare(rightName),
  );
}
