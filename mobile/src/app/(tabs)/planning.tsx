import { useCallback, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Card, ErrorState, LoadingState, PrimaryButton, Screen, SectionTitle, palette, styles as ui } from '@/components/finance-ui';
import { api, formatPKR } from '@/lib/api';
import { useApi } from '@/hooks/use-api';
import type { Affordability } from '@/lib/types';

export default function PlanningScreen() {
  const load = useCallback(() => api.forecast(), []);
  const { data, loading, error, reload } = useApi(load);
  const [item, setItem] = useState('iPhone 15');
  const [price, setPrice] = useState('320000');
  const [months, setMonths] = useState('6');
  const [result, setResult] = useState<Affordability | null>(null);
  const [checking, setChecking] = useState(false);
  const [checkError, setCheckError] = useState<string | null>(null);

  async function check() {
    setChecking(true); setCheckError(null);
    try {
      setResult(await api.affordability({ itemName: item || 'Item', price: Number.parseInt(price, 10), monthsAhead: Number.parseInt(months, 10) || 0 }));
    } catch (caught) { setCheckError(caught instanceof Error ? caught.message : 'Check failed'); }
    finally { setChecking(false); }
  }

  if (loading && !data) return <Screen><LoadingState /></Screen>;
  if (error && !data) return <Screen><View style={local.pad}><ErrorState message={error} retry={reload} /></View></Screen>;
  if (!data) return null;
  const rows = Object.entries(data.byCategory).sort(([, a], [, b]) => b.blend - a.blend).slice(0, 8);
  const max = Math.max(1, ...rows.map(([, value]) => value.blend));

  return <Screen><ScrollView contentContainerStyle={local.content} refreshControl={<RefreshControl refreshing={loading} onRefresh={reload} tintColor={palette.primary} />}>
    <View><Text style={local.title}>Plan ahead</Text><Text style={ui.muted}>Forecasts and purchase decisions grounded in your data.</Text></View>
    <Card><Text style={local.heroLabel}>NEXT-MONTH FORECAST</Text><Text style={local.heroValue}>{formatPKR(data.total.blend)}</Text><Text style={ui.muted}>Range {formatPKR(data.total.low)} – {formatPKR(data.total.high)}</Text></Card>
    <Card><SectionTitle>Category forecast</SectionTitle>{rows.map(([name, value]) => <View key={name} style={local.barRow}><Text numberOfLines={1} style={local.name}>{name.replaceAll('_', ' ')}</Text><View style={local.track}><View style={[local.bar, { width: `${Math.max(3, value.blend / max * 100)}%` }]} /></View><Text style={local.value}>{formatPKR(value.blend)}</Text></View>)}</Card>
    <Card><SectionTitle>Can I afford it?</SectionTitle>
      <Text style={local.label}>Item</Text><TextInput accessibilityLabel="Item name" value={item} onChangeText={setItem} style={local.input} placeholderTextColor={palette.muted} />
      <View style={local.formRow}><View style={local.field}><Text style={local.label}>Price (PKR)</Text><TextInput accessibilityLabel="Price in PKR" keyboardType="number-pad" value={price} onChangeText={setPrice} style={local.input} placeholderTextColor={palette.muted} /></View><View style={local.field}><Text style={local.label}>Months</Text><TextInput accessibilityLabel="Months ahead" keyboardType="number-pad" value={months} onChangeText={setMonths} style={local.input} placeholderTextColor={palette.muted} /></View></View>
      {checkError && <Text style={ui.error}>{checkError}</Text>}<PrimaryButton label={checking ? 'Checking…' : 'Check affordability'} onPress={check} disabled={checking} />
      {result && <View style={[local.result, { borderColor: result.canAfford ? palette.success : palette.warning }]}><Text style={[local.resultTitle, { color: result.canAfford ? palette.success : palette.warning }]}>{result.canAfford ? 'Affordable' : `Short by ${formatPKR(result.shortfall)}`}</Text><Text style={ui.muted}>Available after emergency buffer: {formatPKR(result.available)}</Text>{!result.canAfford && result.monthsNeededAtCurrentRate >= 0 && <Text style={ui.muted}>Estimated saving time: {result.monthsNeededAtCurrentRate} months</Text>}</View>}
    </Card>
    <Text style={ui.muted}>{data.method}</Text>
  </ScrollView></Screen>;
}

const local = StyleSheet.create({
  content: { padding: 16, gap: 14, paddingBottom: 32 }, pad: { padding: 16 }, title: { color: palette.text, fontSize: 28, fontWeight: '800' }, heroLabel: { color: palette.primary, letterSpacing: 1.4, fontSize: 11, fontWeight: '800' }, heroValue: { color: palette.text, fontSize: 34, fontWeight: '900' },
  barRow: { flexDirection: 'row', alignItems: 'center', gap: 8 }, name: { color: palette.muted, width: 88, fontSize: 11, textTransform: 'capitalize' }, track: { height: 9, flex: 1, borderRadius: 99, backgroundColor: palette.border, overflow: 'hidden' }, bar: { height: '100%', backgroundColor: palette.primary }, value: { width: 94, color: palette.text, fontSize: 10, textAlign: 'right' },
  label: { color: palette.muted, fontSize: 12, fontWeight: '700' }, input: { minHeight: 46, color: palette.text, backgroundColor: palette.background, borderColor: palette.border, borderWidth: 1, borderRadius: 12, paddingHorizontal: 12 }, formRow: { flexDirection: 'row', gap: 10 }, field: { flex: 1, gap: 6 }, result: { borderLeftWidth: 3, marginTop: 8, padding: 12, backgroundColor: palette.background, borderRadius: 10, gap: 4 }, resultTitle: { fontSize: 17, fontWeight: '800' },
});
