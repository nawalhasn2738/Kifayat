import { useCallback, useEffect, useRef, useState } from 'react';
import { router, useLocalSearchParams } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { ErrorState, LoadingState, PrimaryButton, Screen, SectionTitle, palette, styles as ui } from '@/components/finance-ui';
import { api, createTransactionRequestId } from '@/lib/api';
import { useApi } from '@/hooks/use-api';
import { parsePkrAmount } from '@/lib/validation/transaction';

export default function AddTransferScreen() {
  const params = useLocalSearchParams<{ id?: string }>();
  const rawId = Array.isArray(params.id) ? params.id[0] : params.id;
  const editId = rawId ? Number.parseInt(rawId, 10) : null;
  const load = useCallback(async () => ({
    accounts: await api.activeAccounts(), transfer: editId ? await api.transfer(editId) : null,
  }), [editId]);
  const { data, loading, error, reload } = useApi(load);
  const [sourceAccountId, setSourceAccountId] = useState<number | null>(null);
  const [destinationAccountId, setDestinationAccountId] = useState<number | null>(null);
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [initialized, setInitialized] = useState(false);
  const requestId = useRef<string | null>(null);

  useEffect(() => {
    if (!data?.transfer || initialized) return;
    // Populate the controlled correction form once after its local record loads.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSourceAccountId(data.transfer.sourceAccount.id);
    setDestinationAccountId(data.transfer.destinationAccount.id);
    setAmount(String(data.transfer.amount));
    setDescription(data.transfer.description ?? '');
    setInitialized(true);
  }, [data, initialized]);

  if (loading && !data) return <Screen><LoadingState /></Screen>;
  if (error && !data) return <Screen><View style={local.pad}><ErrorState message={error} retry={reload} /></View></Screen>;
  if (!data) return null;

  async function save() {
    if (saving) return;
    setFormError(null);
    try {
      if (!sourceAccountId || !destinationAccountId) throw new Error('Select a source and destination account.');
      const input = { date: data!.transfer?.date ?? new Date().toISOString(), amount: parsePkrAmount(amount),
        sourceAccountId, destinationAccountId, description: description.trim() || null };
      setSaving(true);
      if (editId) await api.updateTransfer(editId, input);
      else await api.createTransfer(input, requestId.current ??= createTransactionRequestId());
      router.back();
    } catch (caught) {
      setFormError(caught instanceof Error ? caught.message : 'Could not save transfer.');
    } finally {
      setSaving(false);
    }
  }

  return <Screen><ScrollView contentContainerStyle={local.content}>
    <SectionTitle>{editId ? 'Correct transfer' : 'Transfer between accounts'}</SectionTitle>
    <Text style={ui.muted}>Transfers move money without counting as income or spending.</Text>
    <TextInput accessibilityLabel={'Transfer amount in PKR'} keyboardType={'number-pad'} value={amount} onChangeText={setAmount} placeholder={'5000'} placeholderTextColor={palette.muted} style={local.input} />
    <Choices label={'From'} accounts={data.accounts} selected={sourceAccountId} onSelect={setSourceAccountId} />
    <Choices label={'To'} accounts={data.accounts} selected={destinationAccountId} onSelect={setDestinationAccountId} />
    <TextInput accessibilityLabel={'Transfer description'} value={description} onChangeText={setDescription} placeholder={'Optional note'} placeholderTextColor={palette.muted} style={local.input} />
    {formError && <Text accessibilityRole={'alert'} style={ui.error}>{formError}</Text>}
    <PrimaryButton label={saving ? 'Saving...' : 'Save transfer'} onPress={save} disabled={saving} />
  </ScrollView></Screen>;
}

function Choices({ label, accounts, selected, onSelect }: { label: string; accounts: Awaited<ReturnType<typeof api.accounts>>; selected: number | null; onSelect: (id: number) => void }) {
  return <View style={local.field}><Text style={local.label}>{label}</Text>{accounts.map((account) =>
    <Pressable key={account.id} accessibilityRole={'button'} accessibilityState={{ selected: selected === account.id }}
      onPress={() => onSelect(account.id)} style={[local.account, selected === account.id && local.active]}>
      <Text style={local.accountName}>{account.name}</Text><Text style={ui.muted}>{account.type}</Text>
    </Pressable>)}</View>;
}

const local = StyleSheet.create({
  content: { padding: 16, gap: 16, paddingBottom: 40 }, pad: { padding: 16 }, field: { gap: 7 },
  label: { color: palette.muted, fontSize: 12, fontWeight: '700' },
  input: { minHeight: 48, color: palette.text, borderColor: palette.border, borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, backgroundColor: palette.card },
  account: { borderColor: palette.border, borderWidth: 1, borderRadius: 12, padding: 12 },
  active: { borderColor: palette.primary, backgroundColor: palette.primarySoft }, accountName: { color: palette.text, fontWeight: '700' },
});
