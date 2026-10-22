import { useCallback } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Card, ErrorState, LoadingState, Screen, SectionTitle, palette, styles as ui } from '@/components/finance-ui';
import { api, API_URL, formatPKR } from '@/lib/api';
import { useApi } from '@/hooks/use-api';

export default function OverviewScreen() {
  const load = useCallback(async () => {
    const [summary, risk] = await Promise.all([api.summary(), api.risk()]);
    return { summary, risk };
  }, []);
  const { data, loading, error, reload } = useApi(load);

  if (loading && !data) return <Screen><LoadingState /></Screen>;
  if (error && !data) return <Screen><View style={local.pad}><ErrorState message={`${error}\n${API_URL}`} retry={reload} /></View></Screen>;
  if (!data) return null;

  const { summary, risk } = data;
  const riskTone = risk.band === 'high'
    ? { backgroundColor: palette.errorSurface, color: palette.error }
    : risk.band === 'moderate'
      ? { backgroundColor: palette.warningSurface, color: palette.warning }
      : { backgroundColor: palette.successSurface, color: palette.income };
  const maxExpense = Math.max(1, ...summary.monthlyTotals.map((item) => item.expense));
  return (
    <Screen>
      <ScrollView
        contentContainerStyle={local.content}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={reload} tintColor={palette.primary} />}>
        <View>
          <Text style={local.eyebrow}>PERSONAL FINANCE</Text>
          <Text style={local.title}>Your money, clearly.</Text>
          <Text style={ui.muted}>As of {new Date(summary.asOf).toLocaleDateString('en-PK')}</Text>
        </View>

        <View style={local.grid}>
          <Kpi label="Total balance" value={formatPKR(summary.totalBalance)} />
          <Kpi label="Spend MTD" value={formatPKR(summary.spend.thisMonthMTD)} />
          <Kpi label="Monthly income" value={formatPKR(summary.income.thisMonth)} />
          <Kpi label="Savings rate" value={`${Math.round(summary.savings.rate * 100)}%`} />
        </View>

        <Card>
          <View style={local.rowBetween}>
            <SectionTitle>Risk profile</SectionTitle>
            <View style={[local.badge, { backgroundColor: riskTone.backgroundColor }]}>
              <Text style={[local.badgeText, { color: riskTone.color }]}>{risk.score}/100 · {risk.band}</Text>
            </View>
          </View>
          {risk.reasons.map((reason) => <Text key={reason} style={ui.muted}>• {reason}</Text>)}
        </Card>

        <Card>
          <SectionTitle>Monthly spending</SectionTitle>
          {summary.monthlyTotals.map((item) => (
            <View key={item.month} style={local.barRow}>
              <Text style={local.month}>{item.month.slice(5)}</Text>
              <View style={local.track}><View style={[local.bar, { width: `${Math.max(3, item.expense / maxExpense * 100)}%` }]} /></View>
              <Text style={local.amount}>{formatPKR(item.expense)}</Text>
            </View>
          ))}
        </Card>

        <Card>
          <SectionTitle>Top categories</SectionTitle>
          {(summary.topCategoriesMTD.length ? summary.topCategoriesMTD : []).map((item, index) => (
            <View key={item.category} style={local.categoryRow}>
              <Text style={local.rank}>{index + 1}</Text>
              <Text style={local.category}>{item.category.replaceAll('_', ' ')}</Text>
              <Text style={local.categoryAmount}>{formatPKR(item.total)}</Text>
            </View>
          ))}
          {!summary.topCategoriesMTD.length && <Text style={ui.muted}>No spending categories in this period.</Text>}
        </Card>
      </ScrollView>
    </Screen>
  );
}

function Kpi({ label, value }: { label: string; value: string }) {
  return <View style={local.kpi}><Text style={local.kpiLabel}>{label}</Text><Text numberOfLines={1} adjustsFontSizeToFit style={local.kpiValue}>{value}</Text></View>;
}

const local = StyleSheet.create({
  content: { padding: 16, gap: 14, paddingBottom: 32 },
  pad: { padding: 16 },
  eyebrow: { color: palette.primary, fontSize: 11, fontWeight: '800', letterSpacing: 1.5 },
  title: { color: palette.text, fontSize: 28, fontWeight: '800', marginVertical: 4 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  kpi: { width: '48%', flexGrow: 1, minHeight: 100, backgroundColor: palette.card, borderColor: palette.border, borderWidth: 1, borderRadius: 16, padding: 14, justifyContent: 'space-between' },
  kpiLabel: { color: palette.muted, fontSize: 12, textTransform: 'uppercase' },
  kpiValue: { color: palette.text, fontSize: 21, fontWeight: '800' },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  badge: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5 },
  badgeText: { color: palette.text, fontSize: 11, fontWeight: '700', textTransform: 'capitalize' },
  barRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  month: { color: palette.muted, width: 24, fontSize: 12 },
  track: { flex: 1, height: 9, borderRadius: 99, backgroundColor: palette.border, overflow: 'hidden' },
  bar: { height: '100%', borderRadius: 99, backgroundColor: palette.primary },
  amount: { color: palette.text, width: 104, textAlign: 'right', fontSize: 11 },
  categoryRow: { flexDirection: 'row', alignItems: 'center', borderTopColor: palette.border, borderTopWidth: 1, paddingVertical: 10 },
  rank: { color: palette.primary, width: 26, fontWeight: '800' },
  category: { color: palette.text, flex: 1, textTransform: 'capitalize' },
  categoryAmount: { color: palette.muted, fontWeight: '600' },
});
