import { useCallback } from 'react';
import { router, useLocalSearchParams } from 'expo-router';
import { Alert, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Card, ErrorState, LoadingState, PrimaryButton, Screen, SectionTitle, palette, styles as ui } from '@/components/finance-ui';
import { api, formatTransactionPKR, transactionAmountTone } from '@/lib/api';
import { useApi } from '@/hooks/use-api';

export default function TransactionDetailsScreen() {
  const params = useLocalSearchParams<{ id: string; from?: string }>();
  const rawId = Array.isArray(params.id) ? params.id[0] : params.id;
  const id = Number.parseInt(rawId ?? '', 10);
  const load = useCallback(() => api.transaction(id), [id]);
  const { data, loading, error, reload } = useApi(load);

  if (loading && !data) return <Screen><LoadingState /></Screen>;
  if (error && !data) return <Screen><View style={local.pad}><ErrorState message={error} retry={reload} /></View></Screen>;
  if (!data) return null;

  const tone = transactionAmountTone(data.type, data.amount);
  const positive = tone === 'positive';
  const remove = () => Alert.alert('Delete transaction?', 'This will also reverse its account balance change.', [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Delete', style: 'destructive', onPress: () => void api.deleteTransaction(id).then(() => router.replace('/(tabs)/transactions')).catch((caught) => Alert.alert('Could not delete', caught instanceof Error ? caught.message : 'Please try again.')) },
  ]);
  return (
    <Screen>
      <ScrollView contentContainerStyle={local.content} refreshControl={<RefreshControl refreshing={loading} onRefresh={reload} tintColor={palette.primary} />}>
        <Card>
          <Text style={local.eyebrow}>TRANSACTION #{rawId}</Text>
          <Text style={[local.amount, { color: positive ? palette.success : tone === 'negative' ? palette.danger : palette.text }]}>{formatTransactionPKR(data.amount)}</Text>
          <Text style={ui.muted}>Route parameter received from {params.from ?? 'a direct link'}.</Text>
        </Card>

        <Card>
          <SectionTitle>Details</SectionTitle>
          <Detail label="Merchant" value={data.merchant ?? 'Not provided'} />
          <Detail label="Date" value={new Date(data.date).toLocaleDateString('en-PK', { dateStyle: 'long' })} />
          <Detail label="Type" value={data.type} />
          <Detail label="Category" value={(data.category?.name ?? 'Uncategorized').replaceAll('_', ' ')} />
          <Detail label="Account" value={`${data.account.name} · ${data.account.type}`} />
          <Detail label="Description" value={data.description ?? 'No description'} />
          <Detail label="Anomaly" value={data.isAnomaly ? 'Flagged for review' : 'No unusual activity detected'} />
        </Card>
        <PrimaryButton label="Edit transaction" onPress={() => router.push({ pathname: '/add-transaction', params: { id: String(id) } })} />
        <Text accessibilityRole="button" onPress={remove} style={local.delete}>Delete transaction</Text>
      </ScrollView>
    </Screen>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return <View style={local.detail}><Text style={local.label}>{label}</Text><Text style={local.value}>{value}</Text></View>;
}

const local = StyleSheet.create({
  content: { padding: 16, gap: 14, paddingBottom: 32 },
  pad: { padding: 16 },
  eyebrow: { color: palette.primary, fontSize: 11, fontWeight: '800', letterSpacing: 1.3 },
  amount: { fontSize: 32, fontWeight: '900' },
  detail: { borderTopColor: palette.border, borderTopWidth: 1, paddingTop: 11, gap: 3 },
  label: { color: palette.muted, fontSize: 11, fontWeight: '700', textTransform: 'uppercase' },
  value: { color: palette.text, fontSize: 15, textTransform: 'capitalize' },
  delete: { color: palette.error, textAlign: 'center', padding: 14, fontWeight: '700' },
});
