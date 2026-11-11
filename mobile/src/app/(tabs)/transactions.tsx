import { useCallback, useEffect, useRef, useState } from 'react';
import { router, useFocusEffect } from 'expo-router';
import { FlatList, KeyboardAvoidingView, Platform, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Card, PrimaryButton, Screen, palette, styles as ui } from '@/components/finance-ui';
import { api, formatPKR, formatTransactionPKR, transactionAmountTone } from '@/lib/api';
import type { Transaction } from '@/lib/types';
import { activityDetailRoute, activityKey } from '@/lib/finance/activity-presentation';
import { reportingCalendarDate, reportingMonthKey, reportingMonthRange } from '@/lib/finance/reporting-calendar';
import type { ActivityItem } from '@/lib/services/activity-core';
import { createActivityBrowser, initialActivityBrowserState } from '@/lib/services/activity-browser-core';
import { activityDateRange, normalizeActivityFilters, type ActivityFilters } from '@/lib/validation/activity';

export default function TransactionsScreen() {
  const list = useRef<FlatList<ActivityItem>>(null);
  const [state, setState] = useState(initialActivityBrowserState);
  useEffect(() => { list.current?.scrollToOffset({ offset: 0, animated: false }); }, [state.items]);
  const [browser] = useState(() => createActivityBrowser({ fetchPage: api.activity, changed: setState }));
  const [accounts, setAccounts] = useState<Awaited<ReturnType<typeof api.accounts>>>([]);
  const [categories, setCategories] = useState<Awaited<ReturnType<typeof api.categories>>>([]);
  const [catalogError, setCatalogError] = useState(false);
  const [expanded, setExpanded] = useState(false), [formError, setFormError] = useState<string | null>(null);
  const [type, setType] = useState<ActivityFilters['type']>('all');
  const [category, setCategory] = useState('all'), [account, setAccount] = useState('all'), [search, setSearch] = useState('');
  const [mode, setMode] = useState<'all' | 'month' | 'range'>('all');
  const [month, setMonth] = useState(() => reportingMonthKey(new Date()));
  const [from, setFrom] = useState(''), [before, setBefore] = useState('');
  useFocusEffect(useCallback(() => {
    let active = true;
    void browser.refresh();
    setCatalogError(false);
    void Promise.all([api.accounts(), api.categories()]).then(([accountRows, categoryRows]) => {
      if (active) { setAccounts(accountRows); setCategories(categoryRows); }
    }).catch(() => { if (active) setCatalogError(true); });
    return () => { active = false; browser.invalidate(); };
  }, [browser]));
  function apply() {
    try {
      const filters: ActivityFilters = normalizeActivityFilters({ type, ...(account !== 'all' ? { accountId: Number(account) } : {}),
        ...(category !== 'all' ? { categoryId: category === 'uncategorized' ? null : Number(category) } : {}),
        ...activityDateRange(mode, month, from, before), search });
      setFormError(null); setExpanded(false); void browser.apply(filters);
    } catch (caught) { setFormError(caught instanceof Error ? caught.message : 'Check the filters.'); }
  }
  function clear() {
    setType('all'); setCategory('all'); setAccount('all'); setSearch(''); setMode('all'); setFrom(''); setBefore('');
    setMonth(reportingMonthKey(new Date())); setFormError(null); void browser.apply({ type: 'all' });
  }
  function shiftMonth(direction: -1 | 1) {
    try {
      const range = reportingMonthRange(month);
      setMonth(reportingMonthKey(direction < 0 ? new Date(range.start.getTime() - 1) : range.endExclusive));
      setFormError(null);
    } catch { setFormError('Enter a valid month as YYYY-MM.'); }
  }
  const active = [state.filters.type === 'all' ? 'All types' : state.filters.type,
    state.filters.categoryId === null ? 'Uncategorized transactions' : state.filters.categoryId ? (categories.find(row => row.id === state.filters.categoryId)?.name ?? 'Selected category') : 'All categories',
    state.filters.accountId ? (accounts.find(row => row.id === state.filters.accountId)?.name ?? 'Selected account') : 'All accounts',
    state.filters.start ? `From ${reportingCalendarDate(state.filters.start)} (inclusive)` : 'All earlier dates',
    state.filters.endExclusive ? `Before ${reportingCalendarDate(state.filters.endExclusive)} (exclusive)` : 'No end date',
    state.filters.search ? `Search: ${state.filters.search}` : '',
  ].filter(Boolean).join(' ? ');
  return <Screen><KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'} keyboardVerticalOffset={90}>
    <FlatList ref={list}
      data={state.items} keyExtractor={activityKey} contentContainerStyle={local.list} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag"
      refreshControl={<RefreshControl refreshing={state.loading} onRefresh={() => void browser.refresh()} tintColor={palette.primary} />}
      ListHeaderComponent={<View style={local.header}>
        <Text style={local.title}>Activity</Text>
        <Text style={ui.muted}>{state.items.length} events on page {state.pageIndex + 1} ? newest first ? Asia/Karachi</Text>
        <Text accessibilityLiveRegion="polite" style={ui.muted}>{active}</Text>
        <PrimaryButton label="Transfer money" onPress={() => router.push('/add-transfer')} />
        <View style={local.buttons}><Pressable accessibilityRole="button" accessibilityState={{ expanded }} onPress={() => setExpanded(value => !value)} style={local.filterButton}><Text style={local.filterText}>{expanded ? 'Hide filters' : 'Filters'}</Text></Pressable>
          <Pressable accessibilityRole="button" onPress={clear} style={local.filterButton}><Text style={local.filterText}>Clear filters</Text></Pressable></View>
        {expanded ? <View style={local.filters}>
          <Text style={ui.muted}>Choose filters, then apply. Search stays on this device.</Text>
          <ChoiceRow label="Type" value={type} options={['all', 'income', 'expense', 'transfer'].map(value => ({ value, label: value === 'all' ? 'All types' : value }))} onChange={value => setType(value as ActivityFilters['type'])} />
          <ChoiceRow label="Category" value={category} options={[{ value: 'all', label: 'All categories' }, { value: 'uncategorized', label: 'Uncategorized' }, ...categories.map(row => ({ value: String(row.id), label: row.name.replaceAll('_', ' ') }))]} onChange={setCategory} />
          <Text style={ui.muted}>Category filters apply to transaction records. Transfers between two accounts have no category and are excluded when a category is selected.</Text>
          <ChoiceRow label="Account" value={account} options={[{ value: 'all', label: 'All accounts' }, ...accounts.map(row => ({ value: String(row.id), label: row.name + (row.archivedAt ? ' (archived)' : '') }))]} onChange={setAccount} />
          {catalogError ? <Text accessibilityRole="alert" style={ui.error}>Account/category choices could not be refreshed. Reopen Activity to retry; existing selections are preserved.</Text> : null}
          <ChoiceRow label="Dates" value={mode} options={[{ value: 'all', label: 'All dates' }, { value: 'month', label: 'Calendar month' }, { value: 'range', label: 'Custom range' }]} onChange={value => setMode(value as typeof mode)} />
          {mode === 'month' ? <><TextInput accessibilityLabel="Historical month YYYY-MM" placeholder="YYYY-MM" placeholderTextColor={palette.muted} value={month} onChangeText={setMonth} style={local.input} />
            <View style={local.buttons}><Pressable accessibilityRole="button" onPress={() => shiftMonth(-1)} style={local.filterButton}><Text style={local.filterText}>Previous month</Text></Pressable><Pressable accessibilityRole="button" onPress={() => shiftMonth(1)} style={local.filterButton}><Text style={local.filterText}>Next month</Text></Pressable></View></> : null}
          {mode === 'range' ? <><TextInput accessibilityLabel="Start date inclusive YYYY-MM-DD" placeholder="From YYYY-MM-DD (inclusive)" placeholderTextColor={palette.muted} value={from} onChangeText={setFrom} style={local.input} />
            <TextInput accessibilityLabel="End date exclusive YYYY-MM-DD" placeholder="Before YYYY-MM-DD (exclusive)" placeholderTextColor={palette.muted} value={before} onChangeText={setBefore} style={local.input} /><Text style={ui.muted}>Start midnight is included; end midnight is excluded in Asia/Karachi. Leave one bound empty for an open range.</Text></> : null}
          <TextInput accessibilityLabel="Search merchant or description" placeholder="Merchant or description" placeholderTextColor={palette.muted} value={search} onChangeText={setSearch} maxLength={200} style={local.input} returnKeyType="search" onSubmitEditing={apply} />
          {formError ? <Text accessibilityRole="alert" style={ui.error}>{formError}</Text> : null}
          <PrimaryButton label="Apply filters" onPress={apply} />
        </View> : null}
        {state.loading ? <Text accessibilityLiveRegion="polite" style={ui.muted}>Loading activity?</Text> : null}
        {state.error ? <><Text accessibilityRole="alert" style={ui.error}>{state.error}</Text><PrimaryButton label="Retry activity" onPress={() => void browser.retry()} /></> : null}
      </View>}
      ListEmptyComponent={!state.loading && !state.error ? <View style={local.empty}><Text style={local.emptyTitle}>No matching activity</Text><Text style={ui.muted}>Try a broader period or clear filters. Use Add in the header to record a transaction.</Text></View> : undefined}
      ListFooterComponent={<View style={local.header}>
        {state.loading ? <Text accessibilityLiveRegion="polite" style={ui.muted}>Loading page?</Text> : null}
        {state.error && state.items.length > 0 ? <><Text accessibilityRole="alert" style={ui.error}>{state.error}</Text><PrimaryButton label="Retry page" onPress={() => void browser.retry()} /></> : null}
        <View style={local.buttons}>
        <PrimaryButton label="Newer events" disabled={state.loading || state.pageIndex === 0} onPress={() => void browser.previous()} />
        <PrimaryButton label="Older events" disabled={state.loading || !state.nextCursor || !!state.error} onPress={() => void browser.next()} />
      </View>{!state.loading && state.items.length > 0 && !state.nextCursor ? <Text style={ui.muted}>End of matching history.</Text> : null}</View>}
      renderItem={({ item }) => <Pressable accessibilityRole="button" accessibilityLabel={`Open ${item.kind === 'transfer' || item.type === 'transfer' ? 'transfer' : item.type} dated ${reportingCalendarDate(item.date)}`}
        onPress={() => router.push(activityDetailRoute(item))} style={({ pressed }) => pressed && local.pressed}>
        {item.kind === 'transfer' ? <TransferRow item={item} /> : <TransactionRow item={item} />}
      </Pressable>}
    />
  </KeyboardAvoidingView></Screen>;
}
function ChoiceRow({ label, value, options, onChange }: { label: string; value: string; options: { value: string; label: string }[]; onChange: (value: string) => void }) {
  return <View style={{ gap: 6 }}><Text style={local.filterText}>{label}</Text><ScrollView horizontal showsHorizontalScrollIndicator keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: 10, alignItems: 'center' }}>
    {options.map(option => <Pressable key={option.value} accessibilityRole="button" accessibilityState={{ selected: value === option.value }} onPress={() => onChange(option.value)} style={[local.choice, value === option.value && local.selected]}>
      <Text style={{ color: value === option.value ? palette.card : palette.text }}>{option.label}</Text>
    </Pressable>)}
  </ScrollView></View>;
}

function TransferRow({ item }: { item: Awaited<ReturnType<typeof api.transfers>>[number] }) {
  return <Card><View style={local.row}>
    <View style={[local.icon, { backgroundColor: palette.border }]}><Text style={{ color: palette.primary }}>↔</Text></View>
    <View style={local.detail}><Text style={local.merchant}>Transfer</Text>
      <Text style={ui.muted}>{reportingCalendarDate(item.date)} ? {item.sourceAccount.name} → {item.destinationAccount.name}</Text></View>
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
          <Text numberOfLines={1} style={local.merchant}>{item.type === 'transfer' ? 'Legacy transfer' : item.merchant ?? item.category?.name ?? 'Transaction'}</Text>
          <Text style={ui.muted}>{reportingCalendarDate(item.date)} · {(item.category?.name ?? 'uncategorized').replaceAll('_', ' ')} ? {item.account.name}</Text>
        </View>
        <Text style={[local.txAmount, { color: positive ? palette.success : negative ? palette.danger : palette.text }]}>{formatTransactionPKR(item.amount)}</Text>
      </View>
    </Card>
  );
}

const local = StyleSheet.create({
  buttons: { flexDirection: 'row', gap: 10, alignItems: 'center', flexWrap: 'wrap' },
  filters: { gap: 12, paddingVertical: 12 },
  filterButton: { minHeight: 48, paddingHorizontal: 10, justifyContent: 'center' },
  filterText: { color: palette.primary, fontWeight: '700' },
  input: { minHeight: 48, color: palette.text, backgroundColor: palette.background, padding: 12, borderWidth: 1, borderColor: palette.border, borderRadius: 10 },
  choice: { minHeight: 44, paddingHorizontal: 12, justifyContent: 'center', borderWidth: 1, borderColor: palette.border, borderRadius: 16 },
  selected: { backgroundColor: palette.primary },
  list: { padding: 16, gap: 10, paddingBottom: 30 },
  emptyList: { flexGrow: 1 },
  pad: { padding: 16 },
  header: { gap: 10, marginBottom: 8 },
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
