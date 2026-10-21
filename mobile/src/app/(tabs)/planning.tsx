import { useCallback, useEffect, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Card, ErrorState, LoadingState, PrimaryButton, Screen, SectionTitle, palette, styles as ui } from '@/components/finance-ui';
import { api, formatPKR } from '@/lib/api';
import { FORECAST_CATEGORY_LABEL, FORECAST_TOTAL_LABEL, forecastBasisLabel, forecastCategoryRows } from '@/lib/finance/forecast-presentation';
import type { Affordability } from '@/lib/types';
import { parsePlanningHorizon } from '@/lib/validation/affordability';
import { parsePkrAmount } from '@/lib/validation/transaction';
import type { ConfirmHistoryStartResult, CorrectHistoryStartResult } from '@/lib/services/history-start-commands-core';
import type { MissingProfileRecoveryResult } from '@/lib/services/history-start-recovery-core';
import type { HistoryWorkflowReadResult } from '@/lib/services/history-workflow-core';
import { createHistorySubmissionRunner, createLatestRequestCoordinator, forecastReadinessText, historyActionError, parseRecoveryPkr } from '@/lib/services/history-workflow-ui';
import { createOpeningBalanceRunner } from '@/lib/services/opening-balance-workflow-ui';

type HistoryOutcome = ConfirmHistoryStartResult | CorrectHistoryStartResult | MissingProfileRecoveryResult;

export default function PlanningScreen() {
  const [data, setData] = useState<HistoryWorkflowReadResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [item, setItem] = useState('iPhone 15');
  const [price, setPrice] = useState('320000');
  const [months, setMonths] = useState('6');
  const [result, setResult] = useState<Affordability | null>(null);
  const [checking, setChecking] = useState(false);
  const [checkError, setCheckError] = useState<string | null>(null);
  const [historyDate, setHistoryDate] = useState('');
  const [monthlyIncome, setMonthlyIncome] = useState('');
  const [emergencyFundTarget, setEmergencyFundTarget] = useState('');
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [historyNotice, setHistoryNotice] = useState<string | null>(null);
  const [historySaving, setHistorySaving] = useState(false);
  const [requestCoordinator] = useState(() => createLatestRequestCoordinator<HistoryWorkflowReadResult>({
    loading: setLoading,
    loaded: (value) => { setData(value); setLoadError(null); },
    failed: setLoadError,
  }));
  const load = useCallback(() => requestCoordinator.load(() => api.historyState()), [requestCoordinator]);
  const [submissionRunner] = useState(() => createHistorySubmissionRunner({
    saving: setHistorySaving,
    clearMessages: () => { setHistoryError(null); setHistoryNotice(null); },
    rejected: setHistoryError,
    saved: (message) => { setHistoryNotice(message); setHistoryDate(''); },
    savedButRefreshFailed: () => {
      setHistoryNotice('Change saved, but the latest history and forecast could not be loaded.');
      setHistoryError('The information shown may be out of date. Pull to refresh before making another change.');
    },
    publish: requestCoordinator.publish,
    invalidateReads: requestCoordinator.invalidate,
  }));

  useEffect(() => {
    void load();
  }, [load]);
  async function check() {
    setChecking(true); setCheckError(null);
    try {
      setResult(await api.affordability({ itemName: item || 'Item', price: parsePkrAmount(price), monthsAhead: parsePlanningHorizon(months) }));
    } catch (caught) { setCheckError(caught instanceof Error ? caught.message : 'Check failed'); }
    finally { setChecking(false); }
  }

  async function submitHistory(
    operation: () => Promise<import('@/lib/services/history-workflow-core').HistoryWorkflowActionResult<HistoryOutcome>>,
    success: string,
  ) {
    await submissionRunner.submit(operation, success);
  }
  async function recoverProfile() {
    const income = parseRecoveryPkr(monthlyIncome);
    const target = parseRecoveryPkr(emergencyFundTarget);
    if (income === null || target === null) { setHistoryError(historyActionError('invalid_input')); return; }
    await submitHistory(() => api.recoverFinancialProfile({ monthlyIncome: income, emergencyFundTarget: target }), 'Your local profile was recovered. Confirm a history start when ready.');
  }
  if (loading && !data) return <Screen><LoadingState /></Screen>;
  if (loadError && !data) return <Screen><View style={local.pad}><ErrorState message={loadError} retry={load} /></View></Screen>;
  if (!data) return null;
  if (data.status === 'failed') return <Screen><View style={local.pad}><ErrorState message={historyActionError(data.reason)} retry={load} /></View></Screen>;
  const history = data.history;
  const forecastResult = data.forecast;
  const forecast = forecastResult.forecast;
  const selectedDate = historyDate || (history.status === 'unconfirmed' ? history.suggestion?.calendarDate ?? '' : history.status === 'confirmed' ? history.calendarDate : '');
  const rows = forecast ? forecastCategoryRows(forecast) : [];
  const max = Math.max(1, ...rows.map(([, value]) => value.blend));

  return <Screen><ScrollView contentContainerStyle={local.content} refreshControl={<RefreshControl refreshing={loading} onRefresh={() => { if (!submissionRunner.isActive()) void load(); }} tintColor={palette.primary} />}>
    <View><Text style={local.title}>Plan ahead</Text><Text style={ui.muted}>Forecasts and purchase decisions grounded in your data.</Text></View>
    <OpeningBalances />
    <Card><SectionTitle>Financial history</SectionTitle>
      {history.status === 'confirmed' && <><Text style={local.status}>Confirmed from {history.calendarDate}</Text><Text style={ui.muted}>Enter a different Karachi date to correct it. The saved value is protected against stale updates.</Text><TextInput accessibilityLabel="Correct history start date" value={selectedDate} onChangeText={setHistoryDate} style={local.input} placeholder="YYYY-MM-DD" placeholderTextColor={palette.muted} /><PrimaryButton label={historySaving ? 'Saving...' : 'Save correction'} disabled={historySaving} onPress={() => submitHistory(() => api.correctFinancialHistoryStart({ calendarDate: selectedDate, expectedCurrentValue: history.value }), 'Financial history start corrected.')} /></>}
      {history.status === 'unconfirmed' && <><Text style={local.status}>Not yet confirmed</Text>{history.suggestion ? <Text style={ui.muted}>Suggested from your earliest transaction: {history.suggestion.calendarDate}. Review it before confirming; it is never saved automatically.</Text> : <Text style={ui.muted}>No suggestion is available. Enter when your complete records begin.</Text>}<TextInput accessibilityLabel="History start date" value={selectedDate} onChangeText={setHistoryDate} style={local.input} placeholder="YYYY-MM-DD" placeholderTextColor={palette.muted} /><PrimaryButton label={historySaving ? 'Confirming...' : 'Confirm history start'} disabled={historySaving} onPress={() => submitHistory(() => api.confirmFinancialHistoryStart({ calendarDate: selectedDate }), 'Financial history start confirmed.')} /></>}
      {history.status === 'missing_profile' && <><Text style={local.status}>Profile recovery required</Text><Text style={ui.muted}>Enter both values. Recovery creates an unconfirmed profile and never assumes defaults.</Text><Text style={local.label}>Monthly income (PKR)</Text><TextInput accessibilityLabel="Recovery monthly income" keyboardType="number-pad" value={monthlyIncome} onChangeText={setMonthlyIncome} style={local.input} placeholder="0" placeholderTextColor={palette.muted} /><Text style={local.label}>Emergency fund target (PKR)</Text><TextInput accessibilityLabel="Recovery emergency fund target" keyboardType="number-pad" value={emergencyFundTarget} onChangeText={setEmergencyFundTarget} style={local.input} placeholder="0" placeholderTextColor={palette.muted} /><PrimaryButton label={historySaving ? 'Recovering...' : 'Recover local profile'} disabled={historySaving} onPress={recoverProfile} /></>}
      {(history.status === 'invalid' || history.status === 'transaction_history_invalid') && <><Text style={[local.status, { color: palette.danger }]}>Financial history needs attention</Text><Text style={ui.muted}>{history.status === 'invalid' ? 'The saved history start is invalid.' : 'A transaction date is invalid.'} Forecasting is disabled safely. Repair the underlying data and refresh; no automatic change will be made.</Text></>}
      {loadError && <Text style={ui.error}>Refresh failed: {loadError}. The information shown may be out of date.</Text>}{historyError && <Text style={ui.error}>{historyError}</Text>}{historyNotice && <Text style={local.success}>{historyNotice}</Text>}
    </Card>    <Card><Text style={local.heroLabel}>{FORECAST_TOTAL_LABEL}</Text>{forecast ? <><Text style={local.heroValue}>{formatPKR(forecast.total.blend)}</Text><Text style={ui.muted}>Range {formatPKR(forecast.total.low)} – {formatPKR(forecast.total.high)}</Text></> : <><Text style={local.unavailable}>Forecast unavailable</Text><Text style={ui.muted}>{forecastReadinessText(forecastResult)}</Text></>}</Card>
    {forecast && <Card><SectionTitle>{FORECAST_CATEGORY_LABEL}</SectionTitle>{rows.map(([name, value]) => <View key={name} style={local.barRow}><Text numberOfLines={1} style={local.name}>{name.replaceAll('_', ' ')}</Text><View style={local.track}><View style={[local.bar, { width: `${Math.max(3, value.blend / max * 100)}%` }]} /></View><Text style={local.value}>{formatPKR(value.blend)}</Text></View>)}</Card>}
    <Card><SectionTitle>Can I afford it?</SectionTitle>
      <Text style={local.label}>Item</Text><TextInput accessibilityLabel="Item name" value={item} onChangeText={setItem} style={local.input} placeholderTextColor={palette.muted} />
      <View style={local.formRow}><View style={local.field}><Text style={local.label}>Price (PKR)</Text><TextInput accessibilityLabel="Price in PKR" keyboardType="number-pad" value={price} onChangeText={setPrice} style={local.input} placeholderTextColor={palette.muted} /></View><View style={local.field}><Text style={local.label}>Months</Text><TextInput accessibilityLabel="Months ahead" keyboardType="number-pad" value={months} onChangeText={setMonths} style={local.input} placeholderTextColor={palette.muted} /></View></View>
      {checkError && <Text style={ui.error}>{checkError}</Text>}<PrimaryButton label={checking ? 'Checking…' : 'Check affordability'} onPress={check} disabled={checking} />
      {result && <View style={[local.result, { borderColor: result.canAfford ? palette.success : palette.warning }]}><Text style={[local.resultTitle, { color: result.canAfford ? palette.success : palette.warning }]}>{result.canAfford ? 'Affordable' : `Short by ${formatPKR(result.shortfall)}`}</Text><Text style={ui.muted}>Available after emergency buffer: {formatPKR(result.available)}</Text>{!result.canAfford && result.monthsNeededAtCurrentRate >= 0 && <Text style={ui.muted}>Estimated saving time: {result.monthsNeededAtCurrentRate} months</Text>}</View>}
    </Card>
    {forecast && <><Text style={ui.muted}>{forecastBasisLabel(forecastResult.qualifyingMonths)}</Text><Text style={ui.muted}>{forecast.method}</Text></>}
  </ScrollView></Screen>;
}

function OpeningBalances() {
  const [rows, setRows] = useState<{ account: Awaited<ReturnType<typeof api.accounts>>[number]; state: Awaited<ReturnType<typeof api.openingBalanceState>> }[]>([]);
  const [values, setValues] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fetchRows = useCallback(async () => {
    const accountRows = await api.accounts();
    return Promise.all(accountRows.map(async (account) => ({ account, state: await api.openingBalanceState(account.id) })));
  }, []);
  const [runner] = useState(() => createOpeningBalanceRunner<typeof rows>({ saving: (value) => { if (!value) setBusy(null); }, error: setError, loaded: setRows, savedButStale: (message) => setError(`Change saved, but refresh failed: ${message}`) }));
  const load = useCallback(() => runner.load(fetchRows), [fetchRows, runner]);
  useEffect(() => {
    // Initial repository synchronization for this independently scoped workflow.
    void load().catch((caught) => setError(caught instanceof Error ? caught.message : 'Could not load opening balances.'));
  }, [load]);
  const submit = async (accountId: number, state: (typeof rows)[number]['state']) => {
    if (busy !== null || state.status !== 'available') return;
    const raw = values[accountId] ?? String(state.openingBalance ?? state.candidate);
    if (!/^-?(0|[1-9]\d*)$/.test(raw) || !Number.isSafeInteger(Number(raw))) { setError('Enter a signed whole PKR amount.'); return; }
    setBusy(accountId); setError(null);
    try {
      const result = await runner.submit(() => state.openingBalance === null ? api.confirmOpeningBalance(accountId, Number(raw)) : api.correctOpeningBalance(accountId, state.openingBalance, Number(raw)), fetchRows);
      if (result?.status === 'saved') setValues((current) => ({ ...current, [accountId]: '' }));
    } finally { if (busy !== null) setBusy(null); }
  };
  return <Card><SectionTitle>Opening balances</SectionTitle><Text style={ui.muted}>Suggestions are never confirmed automatically and remain separate from financial-history dates.</Text>
    {rows.map(({ account, state }) => <View key={account.id} style={local.field}><Text style={local.status}>{account.name}</Text>
      {state.status === 'ambiguous' ? <Text style={ui.error}>Reconciliation is unavailable because ledger ownership or legacy transfer history is ambiguous.</Text>
        : state.status === 'available' ? <><Text style={ui.muted}>{state.openingBalance === null ? `Unconfirmed · suggested ${formatPKR(state.candidate)}` : `Confirmed ${formatPKR(state.openingBalance)}`}</Text>
          <TextInput accessibilityLabel={`${account.name} opening balance`} keyboardType={'numbers-and-punctuation'} value={values[account.id] ?? ''} onChangeText={(value) => setValues((current) => ({ ...current, [account.id]: value }))} placeholder={String(state.openingBalance ?? state.candidate)} placeholderTextColor={palette.muted} style={local.input} />
          <PrimaryButton disabled={busy !== null} label={busy === account.id ? 'Saving...' : state.openingBalance === null ? 'Confirm opening balance' : 'Correct opening balance'} onPress={() => void submit(account.id, state)} /></> : <Text style={ui.error}>Account unavailable.</Text>}
    </View>)}{error && <Text style={ui.error}>{error}</Text>}
  </Card>;
}

const local = StyleSheet.create({
  content: { padding: 16, gap: 14, paddingBottom: 32 }, pad: { padding: 16 }, title: { color: palette.text, fontSize: 28, fontWeight: '800' }, heroLabel: { color: palette.primary, letterSpacing: 1.4, fontSize: 11, fontWeight: '800' }, heroValue: { color: palette.text, fontSize: 34, fontWeight: '900' }, unavailable: { color: palette.text, fontSize: 22, fontWeight: '800' }, status: { color: palette.text, fontSize: 16, fontWeight: '800' }, success: { color: palette.success, fontSize: 13, lineHeight: 19 },
  barRow: { flexDirection: 'row', alignItems: 'center', gap: 8 }, name: { color: palette.muted, width: 88, fontSize: 11, textTransform: 'capitalize' }, track: { height: 9, flex: 1, borderRadius: 99, backgroundColor: palette.border, overflow: 'hidden' }, bar: { height: '100%', backgroundColor: palette.primary }, value: { width: 94, color: palette.text, fontSize: 10, textAlign: 'right' },
  label: { color: palette.muted, fontSize: 12, fontWeight: '700' }, input: { minHeight: 46, color: palette.text, backgroundColor: palette.background, borderColor: palette.border, borderWidth: 1, borderRadius: 12, paddingHorizontal: 12 }, formRow: { flexDirection: 'row', gap: 10 }, field: { flex: 1, gap: 6 }, result: { borderLeftWidth: 3, marginTop: 8, padding: 12, backgroundColor: palette.background, borderRadius: 10, gap: 4 }, resultTitle: { fontSize: 17, fontWeight: '800' },
});
