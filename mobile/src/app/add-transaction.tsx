import { useCallback, useState } from 'react';
import { router } from 'expo-router';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { ErrorState, LoadingState, PrimaryButton, Screen, SectionTitle, palette, styles as ui } from '@/components/finance-ui';
import { api } from '@/lib/api';
import { useApi } from '@/hooks/use-api';

export default function AddTransactionScreen() {
  const load = useCallback(async () => {
    const [categories, accounts, summary] = await Promise.all([api.categories(), api.accounts(), api.summary()]);
    return { categories, accounts, summary };
  }, []);
  const { data, loading, error, reload } = useApi(load);
  const [type, setType] = useState<'income' | 'expense'>('expense');
  const [amount, setAmount] = useState('');
  const [merchant, setMerchant] = useState('');
  const [description, setDescription] = useState('');
  const [categoryId, setCategoryId] = useState<number | null>(null);
  const [accountId, setAccountId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  if (loading && !data) return <Screen><LoadingState /></Screen>;
  if (error && !data) return <Screen><View style={local.pad}><ErrorState message={error} retry={reload} /></View></Screen>;
  if (!data) return null;

  const selectedAccountId = accountId ?? data.accounts[0]?.id ?? null;
  const visibleCategories = data.categories.filter((category) =>
    type === 'income'
      ? category.parent === 'Income'
      : category.parent !== 'Income' && category.parent !== 'Transfer',
  );

  async function save() {
    const numericAmount = Number.parseInt(amount, 10);
    if (!Number.isInteger(numericAmount) || numericAmount <= 0) {
      setFormError('Enter a positive whole amount.');
      return;
    }
    if (!selectedAccountId) {
      setFormError('Select an account before saving.');
      return;
    }

    setSaving(true);
    setFormError(null);
    try {
      await api.createTransaction({
        date: data!.summary.asOf.slice(0, 10),
        amount: numericAmount,
        type,
        categoryId,
        accountId: selectedAccountId,
        merchant: merchant.trim() || null,
        description: description.trim() || null,
      });
      router.back();
    } catch (caught) {
      setFormError(caught instanceof Error ? caught.message : 'Could not save transaction.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Screen>
      <KeyboardAvoidingView style={local.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'} keyboardVerticalOffset={90}>
        <ScrollView contentContainerStyle={local.content} keyboardShouldPersistTaps="handled">
          <View>
            <SectionTitle>Record a transaction</SectionTitle>
            <Text style={ui.muted}>The transaction will update the selected account balance.</Text>
          </View>

          <View style={local.segment}>
            {(['expense', 'income'] as const).map((item) => (
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ selected: type === item }}
                key={item}
                onPress={() => { setType(item); setCategoryId(null); }}
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
              {visibleCategories.map((category) => (
                <Pressable accessibilityRole="button" accessibilityState={{ selected: categoryId === category.id }} key={category.id} onPress={() => setCategoryId(category.id)} style={[local.chip, categoryId === category.id && local.chipActive]}>
                  <Text style={[local.chipText, categoryId === category.id && local.chipTextActive]}>{category.name.replaceAll('_', ' ')}</Text>
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
  chipActive: { borderColor: palette.primary, backgroundColor: '#2b2452' },
  chipText: { color: palette.muted, textTransform: 'capitalize' },
  chipTextActive: { color: palette.text },
  accountList: { gap: 8 },
  account: { borderColor: palette.border, borderWidth: 1, borderRadius: 12, padding: 12 },
  accountActive: { borderColor: palette.primary, backgroundColor: '#211d3c' },
  accountName: { color: palette.text, fontWeight: '700' },
});
