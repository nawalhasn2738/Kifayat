import { useCallback, useEffect, useRef, useState } from 'react';
import { router, useLocalSearchParams } from 'expo-router';
import { Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { ErrorState, LoadingState, PrimaryButton, Screen, SectionTitle, palette, styles as ui } from '@/components/finance-ui';
import { api, createTransactionRequestId, formatPKR, OverdraftConfirmationRequiredError, type TransactionMutationOptions } from '@/lib/api';
import { useApi } from '@/hooks/use-api';
import { categoryOptionsForEditor, isCategorySelectionAllowed, reconcileCategorySelection, type SelectableTransactionType } from '@/lib/finance/category-selection';
import { parsePkrAmount, type TransactionInput } from '@/lib/validation/transaction';

export default function AddTransactionScreen() {
  const { id: rawId } = useLocalSearchParams<{ id?: string }>();
  const editId = rawId ? Number.parseInt(Array.isArray(rawId) ? rawId[0] : rawId, 10) : null;
  const load = useCallback(async () => {
    const [categories, accounts, summary, transaction] = await Promise.all([api.categories(), api.activeAccounts(), api.summary(), editId ? api.transaction(editId) : null]);
    if (transaction && !accounts.some((account) => account.id === transaction.account.id)) {
      const historical = (await api.accounts()).find((account) => account.id === transaction.account.id);
      if (historical) accounts.push(historical);
    }
    return { categories, accounts, summary, transaction };
  }, [editId]);
  const { data, loading, error, reload } = useApi(load);
  const [type, setType] = useState<'income' | 'expense'>('expense');
  const [amount, setAmount] = useState('');
  const [merchant, setMerchant] = useState('');
  const [description, setDescription] = useState('');
  const [categoryId, setCategoryId] = useState<number | null>(null);
  const [accountId, setAccountId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [initialized, setInitialized] = useState(false);
  const creationRequestId = useRef<string | null>(null);

  useEffect(() => {
    if (!data?.transaction || initialized) return;
    const transaction = data.transaction;
    // Populate the controlled form once after the asynchronous local record loads.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setType(transaction.type === 'income' ? 'income' : 'expense');
    setAmount(String(Math.abs(transaction.amount))); setMerchant(transaction.merchant ?? '');
    setDescription(transaction.description ?? ''); setCategoryId(transaction.category?.id ?? null);
    setAccountId(transaction.account.id); setInitialized(true);
  }, [data, initialized]);

  if (loading && !data) return <Screen><LoadingState /></Screen>;
  if (error && !data) return <Screen><View style={local.pad}><ErrorState message={error} retry={reload} /></View></Screen>;
  if (!data) return null;

  const selectedAccountId = accountId ?? data.accounts[0]?.id ?? null;
  const originalType: SelectableTransactionType | null = data.transaction
    ? (data.transaction.type === 'income' ? 'income' : data.transaction.type === 'expense' ? 'expense' : null)
    : null;
  const originalCategoryId = data.transaction?.category?.id ?? null;
  const visibleCategories = categoryOptionsForEditor(
    data.categories, type, categoryId, originalCategoryId, originalType,
  );

  function changeType(nextType: SelectableTransactionType) {
    if (nextType === type) return;
    setType(nextType);
    setCategoryId((current) => reconcileCategorySelection(data!.categories, nextType, current));
  }

  function showOverdraftConfirmation(input: TransactionInput, error: OverdraftConfirmationRequiredError, requestId: string | null) {
    Alert.alert(
      'Confirm overdraft',
      `${error.accountName} would have a projected balance of ${formatPKR(error.projectedBalance)}. Confirming will allow this account to go below zero.`,
      [
        { text: 'Cancel', style: 'cancel', onPress: () => setSaving(false) },
        {
          text: 'Confirm',
          style: 'destructive',
          onPress: () => void submitTransaction(input, {
            overdraftConfirmation: { accountId: error.accountId, projectedBalance: error.projectedBalance },
          }, requestId),
        },
      ],
      { cancelable: false },
    );
  }

  async function submitTransaction(input: TransactionInput, options?: TransactionMutationOptions, requestId: string | null = null) {
    try {
      if (editId) await api.updateTransaction(editId, input, options);
      else {
        if (!requestId) throw new Error('A transaction request ID is required.');
        await api.createTransaction(input, { ...options, clientId: requestId });
      }
      setSaving(false);
      router.back();
    } catch (caught) {
      if (caught instanceof OverdraftConfirmationRequiredError) {
        showOverdraftConfirmation(input, caught, requestId);
        return;
      }
      setFormError(caught instanceof Error ? caught.message : 'Could not save transaction.');
      setSaving(false);
    }
  }

  async function save() {
    if (saving) return;
    if (!selectedAccountId) {
      setFormError('Select an account before saving.');
      return;
    }
    if (!isCategorySelectionAllowed(data!.categories, type, categoryId, originalCategoryId, originalType)) {
      setFormError('Select a category that applies to this transaction type, or leave it uncategorized.');
      return;
    }

    setSaving(true);
    setFormError(null);
    try {
      const numericAmount = parsePkrAmount(amount);
      const input: TransactionInput = {
        date: data!.transaction?.date ?? new Date().toISOString(),
        amount: numericAmount,
        type,
        categoryId,
        accountId: selectedAccountId,
        merchant: merchant.trim() || null,
        description: description.trim() || null,
      };
      const requestId = editId ? null : (creationRequestId.current ??= createTransactionRequestId());
      await submitTransaction(input, undefined, requestId);
    } catch (caught) {
      setFormError(caught instanceof Error ? caught.message : 'Could not save transaction.');
      setSaving(false);
    }
  }

  return (
    <Screen>
      <KeyboardAvoidingView style={local.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'} keyboardVerticalOffset={90}>
        <ScrollView contentContainerStyle={local.content} keyboardShouldPersistTaps="handled">
          <View>
            <SectionTitle>{editId ? 'Edit transaction' : 'Record a transaction'}</SectionTitle>
            <Text style={ui.muted}>The transaction will update the selected account balance.</Text>
          </View>

          <View style={local.segment}>
            {(['expense', 'income'] as const).map((item) => (
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ selected: type === item }}
                key={item}
                onPress={() => changeType(item)}
                style={[local.segmentButton, type === item && local.segmentActive]}>
                <Text style={[local.segmentText, type === item && local.segmentTextActive]}>{item}</Text>
              </Pressable>
            ))}
          </View>

          <Field label="Amount (PKR)">
            <TextInput accessibilityLabel="Amount in PKR" keyboardType="number-pad" value={amount} onChangeText={setAmount} placeholder="2500" placeholderTextColor={palette.muted} style={local.input} />
          </Field>
          <Field label="Merchant or source">
            <TextInput accessibilityLabel="Merchant or source" value={merchant} onChangeText={setMerchant} placeholder="e.g. Grocery store" placeholderTextColor={palette.muted} style={local.input} />
          </Field>
          <Field label="Description (optional)">
            <TextInput accessibilityLabel="Description" value={description} onChangeText={setDescription} placeholder="Add a note" placeholderTextColor={palette.muted} style={[local.input, local.multiline]} multiline />
          </Field>

          <Field label="Category">
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={local.chips}>
              <Pressable accessibilityRole={'button'} accessibilityState={{ selected: categoryId === null }} onPress={() => setCategoryId(null)} style={[local.chip, categoryId === null && local.chipActive]}>
                <Text style={[local.chipText, categoryId === null && local.chipTextActive]}>Uncategorized</Text>
              </Pressable>
              {visibleCategories.map((category) => (
                <Pressable accessibilityRole="button" accessibilityState={{ selected: categoryId === category.id }} key={category.id} onPress={() => setCategoryId(category.id)} style={[local.chip, categoryId === category.id && local.chipActive]}>
                  <Text style={[local.chipText, categoryId === category.id && local.chipTextActive]}>{category.name.replaceAll('_', ' ')}{categoryId === category.id && !category.applicableTransactionTypes.includes(type) ? ' (existing)' : ''}</Text>
                </Pressable>
              ))}
            </ScrollView>
          </Field>

          <Field label="Account">
            <View style={local.accountList}>
              {data.accounts.map((account) => (
                <Pressable accessibilityRole="button" accessibilityState={{ selected: selectedAccountId === account.id }} key={account.id} onPress={() => setAccountId(account.id)} style={[local.account, selectedAccountId === account.id && local.accountActive]}>
                  <Text style={local.accountName}>{account.name}</Text>
                  <Text style={ui.muted}>{account.type}</Text>
                </Pressable>
              ))}
            </View>
          </Field>

          {formError && <Text accessibilityRole="alert" style={ui.error}>{formError}</Text>}
          <PrimaryButton label={saving ? 'Saving…' : 'Save transaction'} onPress={save} disabled={saving} />
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <View style={local.field}><Text style={local.label}>{label}</Text>{children}</View>;
}

const local = StyleSheet.create({
  flex: { flex: 1 },
  content: { padding: 16, gap: 16, paddingBottom: 40 },
  pad: { padding: 16 },
  field: { gap: 7 },
  label: { color: palette.muted, fontSize: 12, fontWeight: '700' },
  input: { minHeight: 48, color: palette.text, borderColor: palette.border, borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, backgroundColor: palette.card },
  multiline: { minHeight: 80, paddingTop: 13, textAlignVertical: 'top' },
  segment: { flexDirection: 'row', backgroundColor: palette.card, borderRadius: 12, padding: 4 },
  segmentButton: { flex: 1, minHeight: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 9 },
  segmentActive: { backgroundColor: palette.primary },
  segmentText: { color: palette.muted, textTransform: 'capitalize', fontWeight: '700' },
  segmentTextActive: { color: '#fff' },
  chips: { gap: 8, paddingVertical: 3 },
  chip: { borderColor: palette.border, borderWidth: 1, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 10 },
  chipActive: { borderColor: palette.primary, backgroundColor: palette.primarySoft },
  chipText: { color: palette.muted, textTransform: 'capitalize' },
  chipTextActive: { color: palette.text },
  accountList: { gap: 8 },
  account: { borderColor: palette.border, borderWidth: 1, borderRadius: 12, padding: 12 },
  accountActive: { borderColor: palette.primary, backgroundColor: palette.primarySoft },
  accountName: { color: palette.text, fontWeight: '700' },
});
