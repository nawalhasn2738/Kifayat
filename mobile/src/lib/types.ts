export type Balance = { name: string; type: string; balance: number };
export type CategoryStat = { category: string; total: number; count: number };

export type Summary = {
  asOf: string;
  balances: Balance[];
  totalBalance: number;
  income: { thisMonth: number; lastMonth: number; threeMonthAvg: number };
  spend: { thisMonthMTD: number; thisMonthProjected: number; lastMonth: number; threeMonthAvg: number };
  savings: { thisMonth: number; threeMonthAvg: number; rate: number };
  topCategoriesMTD: CategoryStat[];
  monthlyTotals: { month: string; income: number; expense: number; savings: number }[];
};

export type Transaction = {
  id: number;
  clientId: string;
  date: string;
  amount: number;
  type: 'income' | 'expense' | 'transfer';
  merchant: string | null;
  description: string | null;
  isAnomaly: boolean;
  category: { id: number; name: string } | null;
  account: { id: number; name: string; type: string };
};

export type Category = { id: number; name: string; parent: string | null };
export type Account = { id: number; name: string; type: string; balance: number };
export type Forecast = {
  total: { blend: number; low: number; high: number };
  byCategory: Record<string, { blend: number; low: number; high: number }>;
  method: string;
  asOf: string;
};
export type ForecastReadinessReason =
  | 'history_start_unconfirmed'
  | 'insufficient_complete_months'
  | 'invalid_history_start';
export type ForecastResult =
  | {
    status: 'ready';
    forecast: Forecast;
    requiredCompleteMonths: 3;
    availableCompleteMonths: 3;
    qualifyingMonths: string[];
    guidance: string;
  }
  | {
    status: 'insufficient_history';
    forecast: null;
    reason: ForecastReadinessReason;
    requiredCompleteMonths: 3;
    availableCompleteMonths: number;
    qualifyingMonths: string[];
    guidance: string;
  };
export type Risk = { score: number; band: 'low' | 'moderate' | 'high'; reasons: string[] };
export type Affordability = {
  canAfford: boolean;
  available: number;
  buffer: number;
  shortfall: number;
  monthsNeededAtCurrentRate: number;
  reason: string;
};
