import { useCallback } from 'react';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Card, ErrorState, LoadingState, PrimaryButton, Screen, SectionTitle, palette } from '@/components/finance-ui';
import { api, formatPKR } from '@/lib/api';
import { useApi } from '@/hooks/use-api';

export default function TransferDetailsScreen() {
  const params = useLocalSearchParams<{ id: string }>();
  const rawId = Array.isArray(params.id) ? params.id[0] : params.id;
  const id = Number.parseInt(rawId, 10);
  const load = useCallback(() => api.transfer(id), [id]);
  const { data, loading, error, reload } = useApi(load);
  if (loading && !data) return <Screen><LoadingState /></Screen>;
  if (error && !data) return <Screen><View style={local.pad}><ErrorState message={error} retry={reload} /></View></Screen>;
  if (!data) return null;
  const remove = () => Alert.alert('Delete transfer?', 'Both account effects will be reversed.', [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Delete', style: 'destructive', onPress: () => void api.deleteTransfer(id)
      .then(() => router.replace('/(tabs)/transactions'))
      .catch((caught) => Alert.alert('Could not delete', caught instanceof Error ? caught.message : 'Please try again.')) },
  ]);
  return <Screen><ScrollView contentContainerStyle={local.content}>
    <Card><Text style={local.eyebrow}>TRANSFER #{id}</Text><Text style={local.amount}>{formatPKR(data.amount)}</Text></Card>
    <Card><SectionTitle>Details</SectionTitle>
      <Detail label={'From'} value={data.sourceAccount.name} />
      <Detail label={'To'} value={data.destinationAccount.name} />
      <Detail label={'Date'} value={new Date(data.date).toLocaleDateString('en-PK', { dateStyle: 'long' })} />
      <Detail label={'Description'} value={data.description ?? 'No description'} />
    </Card>
    <PrimaryButton label={'Correct transfer'} onPress={() => router.push({ pathname: '/add-transfer', params: { id: String(id) } })} />
    <Text accessibilityRole={'button'} onPress={remove} style={local.delete}>Delete transfer</Text>
  </ScrollView></Screen>;
}
function Detail({ label, value }: { label: string; value: string }) {
  return <View style={local.detail}><Text style={local.label}>{label}</Text><Text style={local.value}>{value}</Text></View>;
}
const local = StyleSheet.create({
  content: { padding: 16, gap: 14, paddingBottom: 32 }, pad: { padding: 16 },
  eyebrow: { color: palette.primary, fontSize: 11, fontWeight: '800' },
  amount: { color: palette.text, fontSize: 32, fontWeight: '900' },
  detail: { borderTopColor: palette.border, borderTopWidth: 1, paddingTop: 11, gap: 3 },
  label: { color: palette.muted, fontSize: 11, fontWeight: '700', textTransform: 'uppercase' },
  value: { color: palette.text, fontSize: 15 },
  delete: { color: '#ff7b7b', textAlign: 'center', padding: 14, fontWeight: '700' },
});
