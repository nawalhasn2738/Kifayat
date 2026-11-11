import { useCallback, useState } from 'react';
import { router, useFocusEffect, type Href } from 'expo-router';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Card, ErrorState, LoadingState, PrimaryButton, Screen, SectionTitle, palette, styles as ui } from '@/components/finance-ui';
import { api, formatPKR, formatTransactionPKR } from '@/lib/api';
import { createDashboardController, type DashboardState } from '@/lib/services/dashboard-ui';
import { reportingCalendarDate } from '@/lib/finance/reporting-calendar';
import { activityDetailRoute, activityKey } from '@/lib/finance/activity-presentation';

export default function OverviewScreen() {
  const [state, setState] = useState<DashboardState>({ data: null, loading: true, error: null });
  const [controller] = useState(() => createDashboardController({ load: api.dashboard, changed: setState }));
  useFocusEffect(useCallback(() => { void controller.refresh(); return controller.invalidate; }, [controller]));
  if (state.loading && !state.data) return <Screen><LoadingState /></Screen>;
  if (!state.data) return <Screen><View style={local.pad}><ErrorState message={state.error ?? 'Overview is unavailable.'} retry={() => void controller.refresh()} /></View></Screen>;
  const data = state.data;
  const summary = data.summary.status === 'ready' ? data.summary.value : null;
  const risk = data.risk.status === 'ready' ? data.risk.value : null;
  const forecast = data.forecast.status === 'ready' && data.forecast.value.status === 'ready' ? data.forecast.value.forecast : null;
  const savings = data.savings.status === 'ready' ? data.savings.value : null;
  const complete = data.trend.filter(row => row.complete);
  const trendMax = Math.max(1, ...complete.flatMap(row => [row.income!, row.expense!]));
  return <Screen><ScrollView contentContainerStyle={local.content} refreshControl={<RefreshControl refreshing={state.loading} onRefresh={() => void controller.refresh()} tintColor={palette.primary} />}>
    <View><Text style={local.eyebrow}>PERSONAL FINANCE</Text><Text style={local.title}>Your money, clearly.</Text><Text style={ui.muted}>As of {reportingCalendarDate(data.asOf)} · Asia/Karachi</Text></View>
    <Text style={ui.muted}>{data.coverage}</Text>
    {summary && data.hasAccounts ? <>
      <View style={local.grid}>
        <Kpi label="Current account balance" value={formatPKR(summary.totalBalance)} />
        <Kpi label="Recorded income MTD" value={formatPKR(summary.income.thisMonth)} />
        <Kpi label="Recorded expenses MTD" value={formatPKR(summary.spend.thisMonthMTD)} />
        <Kpi label="Recorded net savings MTD" value={formatPKR(summary.savings.thisMonth)} />
        <Kpi label="Recent savings rate" value={data.rate === null ? 'Unavailable' : `${Math.round(data.rate * 100)}%`} />
        <Kpi label="Month-end spending estimate" value={data.projection === null ? 'Unavailable' : formatPKR(data.projection)} />
      </View>
      <Text style={ui.muted}>Balance is the sum of stored account balances, including archived accounts; it is not a reconstructed historical balance. Net savings are recorded income minus expenses, with transfers excluded.</Text>
      <Text style={ui.muted}>The savings rate uses the engine’s latest up to three recorded months, which may include this partial month. A zero average income gives no meaningful rate. The month-end estimate extends this month’s recorded daily pace; it is not the three-complete-month forecast.</Text>
      <View style={local.section}><SectionTitle>{data.currentMonth} recorded cash flow · month to date</SectionTitle>
        <CompareBars rows={[{ label: 'Recorded income', value: summary.income.thisMonth, tone: 'income' }, { label: 'Recorded expenses', value: summary.spend.thisMonthMTD, tone: 'expense' }]} />
      </View>
    </> : <Card><SectionTitle>Financial totals unavailable</SectionTitle><Text style={ui.muted}>{data.summary.status === 'unavailable' ? data.summary.reason : 'No accounts are available. Add an account before interpreting financial totals.'}</Text><PrimaryButton label="Manage accounts" onPress={() => router.push('/accounts' as Href)} /></Card>}

    <View style={local.section}><SectionTitle>Risk explanation</SectionTitle>
      {risk ? <>
        <Text style={[local.metric, { color: risk.band === 'high' ? palette.error : risk.band === 'moderate' ? palette.warning : palette.income }]}>{risk.score}/100 · {risk.band}</Text>
        {risk.reasons.map(reason => <Text key={reason} style={ui.muted}>{reason}</Text>)}
        {risk.factors?.map(factor => <Text key={factor.label} style={ui.muted}>{factor.label}: {Math.round(factor.value * 100)}% component · {Math.round(factor.weight * 100)}% weight</Text>)}
        {data.profile.status === 'ready' ? <Text style={ui.muted}>Configured monthly income: {formatPKR(data.profile.value.monthlyIncome)}. Review it in Settings if it has changed.</Text> : null}
        <Text style={ui.muted}>The rule uses the current partial month and two preceding calendar months. Bands: low ≤30, moderate 31–60, high &gt;60. This score describes the existing indicators, not a guarantee of financial safety.</Text>
      </> : <><Text style={ui.muted}>{data.risk.status === 'unavailable' ? data.risk.reason : 'Risk unavailable.'}</Text><PrimaryButton label="Review financial settings" onPress={() => router.push('/profile-settings' as Href)} /></>}
    </View>

    <View style={local.section}><SectionTitle>Emergency reserve position</SectionTitle>
      {data.reserve.status === 'ready' ? <>
        <Text style={local.metric}>Reserve rule: {formatPKR(data.reserve.value.buffer)}</Text>
        <Text style={ui.muted}>Active checking and savings balance: {formatPKR(data.reserve.value.eligibleBalance)}</Text>
        <Text style={ui.muted}>{data.reserve.value.difference >= 0 ? 'Above reserve by' : 'Below reserve by'} {formatPKR(Math.abs(data.reserve.value.difference))}</Text>
        <Text style={ui.muted}>The existing affordability rule reserves the greater of the configured emergency target and three times average spending for {data.reserve.value.months.join(', ')}. This required buffer is not money already saved or earmarked for a goal.</Text>
      </> : <Text style={ui.muted}>{data.reserve.reason}</Text>}
    </View>

    <View style={local.section}><SectionTitle>Income and spending trends</SectionTitle><Text style={ui.muted}>Complete Karachi months within the previous six months only. Partial or unconfirmed months are omitted; confirmed empty months are zero. Green is income; red is expenses.</Text>
      {complete.length ? complete.map(row => <View key={row.month} style={local.monthGroup}><Text style={local.label}>{row.month} · actual recorded</Text><CompareBars max={trendMax} rows={[{ label: 'Income', value: row.income!, tone: 'income' }, { label: 'Expenses', value: row.expense!, tone: 'expense' }]} /></View>) : <Text style={ui.muted}>No complete-month trend is available yet. Confirm complete financial history in Planning.</Text>}
    </View>

    <View style={local.section}><SectionTitle>Recorded spending and forecast</SectionTitle>
      {summary && data.hasAccounts && forecast ? <>
        <CompareBars rows={[{ label: 'Current month to date · actual', value: summary.spend.thisMonthMTD, tone: 'expense' }, { label: 'Previous complete month · actual', value: summary.spend.lastMonth, tone: 'expense' }, { label: 'Monthly forecast · estimate', value: forecast.total.blend, tone: 'estimate' }]} />
        <Text style={ui.muted}>Forecast range {formatPKR(forecast.total.low)} to {formatPKR(forecast.total.high)}. These periods differ: month-to-date activity is not a full-month outcome.</Text>
        <Text style={ui.muted}>{forecast.method}. Based on the three preceding complete Karachi months; the current partial month is excluded. Estimates are not guaranteed outcomes.</Text>
      </> : <Text style={ui.muted}>{data.forecast.status === 'unavailable' ? data.forecast.reason : data.forecast.value.status === 'insufficient_history' ? data.forecast.value.guidance : 'Add an account before interpreting the forecast.'}</Text>}
      {!data.projection && data.projection !== 0 ? <Text style={ui.muted}>The month-end daily-pace projection is unavailable without confirmed coverage from this month’s start.</Text> : null}
    </View>

    <View style={local.section}><SectionTitle>Top recorded spending categories · MTD</SectionTitle>
      {summary && data.hasAccounts && summary.topCategoriesMTD.length ? <><Text style={ui.muted}>Top three categories; bars show their share of recorded month-to-date expenses, not the complete category list.</Text>
        {summary.topCategoriesMTD.map(category => <View key={category.category} style={local.monthGroup}><Text style={local.label}>{category.category.replaceAll('_', ' ')} · {formatPKR(category.total)}</Text><Bar label={`${category.category} recorded spending ${formatPKR(category.total)}`} value={category.total} max={summary.spend.thisMonthMTD} color={palette.primary} /></View>)}
      </> : <Text style={ui.muted}>{summary && data.hasAccounts ? 'No expenses are recorded this month. History coverage above determines whether that is a complete picture.' : 'Category totals are unavailable.'}</Text>}
    </View>

    <View style={local.section}><SectionTitle>Savings goals</SectionTitle>
      {savings ? <>
        <Text style={ui.muted}>{savings.progressReason}</Text><Text style={ui.muted}>Goals compare against one shared recorded net-savings pool; the amounts are not separately allocated and must not be added together.</Text>
        {!savings.goals.length ? <Text style={ui.muted}>No goal is configured. Add one in Planning.</Text> : null}
        {savings.goals.slice(0, 3).map(goal => <View key={goal.id} style={local.monthGroup}><Text style={local.label}>{goal.name} · target {formatPKR(goal.targetAmount)}</Text>
          {goal.progress.current !== null ? <><Text style={ui.muted}>{formatPKR(goal.progress.current)} recorded net savings · {formatPKR(goal.progress.remaining!)} remaining · {Math.floor(goal.progress.percent!)}%</Text>
            {goal.progress.netSavings! < 0 ? <Text style={ui.muted}>Recorded net deficit {formatPKR(goal.progress.netSavings!)}; no positive progress.</Text> : null}
            <Bar label={`${goal.name}, ${Math.floor(goal.progress.percent!)} percent of target`} value={goal.progress.percent!} max={100} color={palette.primary} />
          </> : <Text style={ui.muted}>Progress is unavailable, not confirmed zero.</Text>}
        </View>)}
        {savings.analysis.status === 'ready' ? <Text style={ui.muted}>Existing recorded-data rule suggests reviewing up to {formatPKR(savings.analysis.recommendation.recommendedMonthlyTransfer)} per month for saving. This is an estimate, not a guaranteed saving or automatic transfer.</Text> : <Text style={ui.muted}>{savings.analysis.guidance}</Text>}
      </> : <Text style={ui.muted}>{data.savings.status === 'unavailable' ? data.savings.reason : 'Savings progress unavailable.'}</Text>}
      <PrimaryButton label="Goals and financial planning" onPress={() => router.push('/(tabs)/planning')} />
    </View>

    <View style={local.section}><SectionTitle>Recent activity</SectionTitle>
      {data.recent.status === 'ready' ? <>
        {!data.recent.value.items.length ? <Text style={ui.muted}>No recorded activity through this cutoff. Add a transaction or transfer when ready.</Text> : null}
        {data.recent.value.items.map(item => <Pressable key={activityKey(item)} accessibilityRole="button" onPress={() => router.push(activityDetailRoute(item))} style={local.activity}>
          <Text style={local.label}>{item.kind === 'transfer' ? 'Transfer' : item.type === 'transfer' ? 'Legacy transfer' : item.merchant ?? item.category?.name ?? item.type} · {item.kind === 'transfer' ? formatPKR(item.amount) : formatTransactionPKR(item.amount)}</Text>
          <Text style={ui.muted}>{reportingCalendarDate(item.date)} · {item.kind === 'transfer' ? `${item.sourceAccount.name} → ${item.destinationAccount.name}` : `${item.account.name} · ${item.category?.name ?? 'Uncategorized'}`}</Text>
          <Text numberOfLines={2} style={ui.muted}>{item.description ?? 'No description recorded'}</Text>
        </Pressable>)}
      </> : <Text style={ui.muted}>{data.recent.reason}</Text>}
      <PrimaryButton label="Open filtered Activity" onPress={() => router.push('/(tabs)/transactions')} />
    </View>
    <PrimaryButton label="Refresh Overview" onPress={() => void controller.refresh()} disabled={state.loading} />
  </ScrollView></Screen>;
}
function Kpi({ label, value }: { label: string; value: string }) {
  return <View style={local.kpi}><Text style={local.kpiLabel}>{label}</Text><Text adjustsFontSizeToFit numberOfLines={2} style={local.kpiValue}>{value}</Text></View>;
}
function Bar({ label, value, max, color }: { label: string; value: number; max: number; color: string }) {
  const percent = max > 0 ? Math.min(100, Math.max(0, value / max * 100)) : 0;
  return <View accessible accessibilityLabel={label} style={local.track}><View style={[local.bar, { width: `${percent}%`, backgroundColor: color }]} /></View>;
}
function CompareBars({ rows, max }: { rows: { label: string; value: number; tone: 'income' | 'expense' | 'estimate' }[]; max?: number }) {
  const scale = max ?? Math.max(1, ...rows.map(row => row.value));
  return <View style={local.comparison}>{rows.map(row => <View key={row.label} style={local.comparison}><Text style={ui.muted}>{row.label}: {formatPKR(row.value)}</Text><Bar label={`${row.label}: ${formatPKR(row.value)}`} value={row.value} max={scale} color={row.tone === 'income' ? palette.income : row.tone === 'expense' ? palette.error : palette.primary} /></View>)}</View>;
}
const local = StyleSheet.create({
  content: { padding: 16, gap: 16, paddingBottom: 40 }, pad: { padding: 16 },
  eyebrow: { color: palette.primary, fontSize: 11, fontWeight: '800', letterSpacing: 1.5 }, title: { color: palette.text, fontSize: 28, fontWeight: '800', marginVertical: 4 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 }, kpi: { flexBasis: '47%', flexGrow: 1, minWidth: 130, minHeight: 112, backgroundColor: palette.card, borderColor: palette.border, borderWidth: 1, borderRadius: 16, padding: 14, gap: 8 },
  kpiLabel: { color: palette.muted, fontSize: 12 }, kpiValue: { color: palette.text, fontSize: 21, fontWeight: '800' },
  section: { gap: 10, paddingVertical: 16, borderTopWidth: 1, borderColor: palette.border }, metric: { color: palette.text, fontSize: 22, fontWeight: '800' },
  label: { color: palette.text, fontSize: 15, fontWeight: '700' }, monthGroup: { gap: 6, paddingVertical: 8 },
  comparison: { gap: 6 }, track: { height: 10, borderRadius: 5, backgroundColor: palette.border, overflow: 'hidden' }, bar: { height: '100%' },
  activity: { minHeight: 48, paddingVertical: 12, gap: 6, borderBottomWidth: 1, borderColor: palette.border },
});
