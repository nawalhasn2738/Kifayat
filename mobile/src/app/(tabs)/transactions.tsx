import { useCallback } from 'react';
import { router, useFocusEffect } from 'expo-router';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { Card, ErrorState, LoadingState, PrimaryButton, Screen, palette, styles as ui } from '@/components/finance-ui';
import { api, formatPKR, formatTransactionPKR, transactionAmountTone } from '@/lib/api';
import { useApi } from '@/hooks/use-api';
import type { Transaction } from '@/lib/types';
import { activityDetailRoute, activityKey } from '@/lib/finance/activity-presentation';

export default function TransactionsScreen() {
  const load = useCallback(() => api.activity(), []);
  const { data, loading, error, reload } = useApi(load);

  useFocusEffect(
    useCallback(() => {
      void reload();
    }, [reload]),
  );

  if (loading && !data) return <Screen><LoadingState /></Screen>;
  if (error && !data) return <Screen><View style={local.pad}><ErrorState message={error} retry={reload} /></View></Screen>;
  if (!data) return null;

  return (
    <Screen>
      <FlatList
        data={data.items}
        keyExtractor={activityKey}
        contentContainerStyle={[local.list, data.items.length === 0 && local.emptyList]}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={reload} tintColor={palette.primary} />}
        ListHeaderComponent={<View style={local.header}><Text style={local.title}>Activity</Text><Text style={ui.muted}>{data.total} events · tap one for details</Text><PrimaryButton label={'Transfer money'} onPress={() => router.push('/add-transfer')} /></View>}
        ListEmptyComponent={<View style={local.empty}><Text style={local.emptyTitle}>No transactions yet</Text><Text style={ui.muted}>Use the Add button in the header to record your first transaction.</Text></View>}
        renderItem={({ item }) => (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Open ${item.kind} ${item.id}`}
            onPress={() => router.push(activityDetailRoute(item))}
            style={({ pressed }) => pressed && local.pressed}>
            {item.kind === 'transfer' ? <TransferRow item={item} /> : <TransactionRow item={item} />}
          </Pressable>
        )}
      />
    </Screen>
  );
}

function TransferRow({ item }: { item: Awaited<ReturnType<typeof api.transfers>>[number] }) {
  return <Card><View style={local.row}>
    <View style={[local.icon, { backgroundColor: palette.border }]}><Text style={{ color: palette.primary }}>↔</Text></View>
    <View style={local.detail}><Text style={local.merchant}>Transfer</Text>
      <Text style={ui.muted}>{item.sourceAccount.name} → {item.destinationAccount.name}</Text></View>
    <Text style={[local.txAmount, { color: palette.text }]}>{formatPKR(item.amount)}</Text>
  </View></Card>;
}

function TransactionRow({ item }: { item: Transaction }) {
  const tone = transactionAmountTone(item.type, item.amount);
  const positive = tone === 'positive';
  const negative = tone === 'negative';
  return (
    <Card>
      <View style={local.row}>
        <View style={[local.icon, { backgroundColor: positive ? palette.successSurface : negative ? palette.errorSurface : palette.surfaceMuted }]}>
          <Text style={{ color: positive ? palette.success : negative ? palette.danger : palette.muted }}>{positive ? '↑' : negative ? '↓' : '•'}</Text>
        </View>
        <View style={local.detail}>
          <Text numberOfLines={1} style={local.merchant}>{item.merchant ?? item.category?.name ?? 'Transaction'}</Text>
          <Text style={ui.muted}>{new Date(item.date).toLocaleDateString('en-PK')} · {(item.category?.name ?? 'uncategorized').replaceAll('_', ' ')}</Text>
        </View>
        <Text style={[local.txAmount, { color: positive ? palette.success : negative ? palette.danger : palette.text }]}>{formatTransactionPKR(item.amount)}</Text>
      </View>
    </Card>
  );
}

const local = StyleSheet.create({
  list: { padding: 16, gap: 10, paddingBottom: 30 },
  emptyList: { flexGrow: 1 },
  pad: { padding: 16 },
  header: { gap: 3, marginBottom: 8 },
  title: { color: palette.text, fontSize: 28, fontWeight: '800' },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 6, padding: 28 },
  emptyTitle: { color: palette.text, fontSize: 18, fontWeight: '800' },
  pressed: { opacity: 0.7 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  icon: { width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  detail: { flex: 1 },
  merchant: { color: palette.text, fontSize: 15, fontWeight: '700' },
  txAmount: { fontSize: 13, fontWeight: '800', maxWidth: 115 },
});
