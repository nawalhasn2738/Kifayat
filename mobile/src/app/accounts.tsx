import { useCallback, useEffect, useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Card, ErrorState, LoadingState, PrimaryButton, Screen, SectionTitle, palette } from '@/components/finance-ui';
import { api, formatPKR } from '@/lib/api';
import { createAccountManagementRunner } from '@/lib/services/account-management-ui';
import { ACCOUNT_TYPES, type AccountType, validateAccountCreationInput } from '@/lib/validation/account';

type ManagedAccount = Awaited<ReturnType<typeof api.managedAccounts>>[number];

export default function AccountsScreen() {
  const [accounts, setAccounts] = useState<ManagedAccount[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [type, setType] = useState<AccountType>('checking');
  const [openingBalance, setOpeningBalance] = useState('0');
  const [renamingId, setRenamingId] = useState<number | null>(null);
  const [renamedValue, setRenamedValue] = useState('');
  const [runner] = useState(() => createAccountManagementRunner<ManagedAccount[]>({
    loading: setLoading, saving: setSavingKey, loaded: setAccounts, error: setError, notice: setNotice,
  }));
  const fetchAccounts = useCallback(() => api.managedAccounts(), []);
  const load = useCallback(() => runner.load(fetchAccounts), [fetchAccounts, runner]);

  useEffect(() => { void load(); }, [load]);

  async function create() {
    if (!/^-?(0|[1-9]\d*)$/.test(openingBalance)) { setError('Enter a signed whole PKR opening balance.'); return; }
    try {
      const input = validateAccountCreationInput({ name, type, openingBalance: Number(openingBalance) });
      const result = await runner.submit('create', `${input.name} created.`, () => api.createAccount(input), fetchAccounts);
      if (result?.status === 'saved') { setName(''); setType('checking'); setOpeningBalance('0'); }
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Could not validate the account.'); }
  }

  async function rename(account: ManagedAccount) {
    const result = await runner.submit(`rename:${account.id}`, 'Account renamed.', () => api.renameAccount(account.id, account.name, renamedValue), fetchAccounts);
    if (result?.status === 'saved') { setRenamingId(null); setRenamedValue(''); }
  }

  function archive(account: ManagedAccount) {
    Alert.alert(`Archive ${account.name}?`, 'It will be hidden from new transactions and transfers. Existing history and balances will not change.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Archive', style: 'destructive', onPress: () => void runner.submit(`archive:${account.id}`, `${account.name} archived.`, () => api.archiveAccount(account.id), fetchAccounts) },
    ]);
  }

  async function restore(account: ManagedAccount) {
    if (!account.archivedAt) { setError('Account status changed; refresh and try again.'); return; }
    await runner.submit(`restore:${account.id}`, `${account.name} restored.`, () => api.restoreAccount(account.id, account.archivedAt!), fetchAccounts);
  }

  function remove(account: ManagedAccount) {
    Alert.alert(`Delete ${account.name}?`, 'Only a zero-balance account with no financial or audit history can be deleted. This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => void runner.submit(`delete:${account.id}`, `${account.name} deleted.`, () => api.deleteUnusedAccount(account.id), fetchAccounts) },
    ]);
  }

  if (loading && !accounts) return <Screen><LoadingState /></Screen>;
  if (error && !accounts) return <Screen><View style={local.pad}><ErrorState message={error} retry={load} /></View></Screen>;
  if (!accounts) return null;
  const active = accounts.filter((account) => account.archivedAt === null);
  const archived = accounts.filter((account) => account.archivedAt !== null);
  const busy = savingKey !== null;
  const beginRename = (account: ManagedAccount) => {
    setRenamingId(account.id);
    setRenamedValue(account.name);
    setError(null);
  };
  const cancelRename = () => {
    setRenamingId(null);
    setRenamedValue('');
  };
  const sectionProps = {
    busy, savingKey, renamingId, renamedValue,
    onRenameValue: setRenamedValue,
    onBeginRename: beginRename,
    onCancelRename: cancelRename,
    onRename: (account: ManagedAccount) => void rename(account),
    onArchive: archive,
    onRestore: restore,
    onDelete: remove,
  };

  return (
    <Screen>
      <KeyboardAvoidingView style={local.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          contentContainerStyle={local.content}
          keyboardShouldPersistTaps={'handled'}
          refreshControl={<RefreshControl refreshing={loading} onRefresh={() => void load()} />}
        >
          <Text style={local.eyebrow}>Accounts</Text>
          <Text style={local.heroTitle}>Manage your money spaces</Text>
          <Text style={local.heroSubtitle}>Active accounts are available for new transactions and transfers. Archived accounts keep their history.</Text>
          <CreateAccountForm
            name={name}
            type={type}
            openingBalance={openingBalance}
            busy={busy}
            creating={savingKey === 'create'}
            onName={setName}
            onType={setType}
            onOpeningBalance={setOpeningBalance}
            onCreate={() => void create()}
          />
          {error ? <Card><Text style={local.error}>{error}</Text></Card> : null}
          {notice ? <Text style={local.notice} accessibilityLiveRegion={'polite'}>{notice}</Text> : null}
          {busy ? <Text style={local.progress} accessibilityLiveRegion={'polite'}>Updating account…</Text> : null}
          <AccountSection
            accounts={active}
            title={'Active accounts'}
            empty={'No active accounts.'}
            {...sectionProps}
          />
          <AccountSection accounts={archived} {...sectionProps} />
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

type CreateAccountFormProps = {
  name: string;
  type: AccountType;
  openingBalance: string;
  busy: boolean;
  creating: boolean;
  onName(value: string): void;
  onType(value: AccountType): void;
  onOpeningBalance(value: string): void;
  onCreate(): void;
};

function CreateAccountForm(props: CreateAccountFormProps) {
  return (
    <Card>
      <SectionTitle>New account</SectionTitle>
      <Text style={local.fieldLabel}>Account name</Text>
      <TextInput
        style={local.input}
        value={props.name}
        onChangeText={props.onName}
        editable={!props.busy}
        placeholder={'e.g. Salary account'}
        placeholderTextColor={palette.muted}
      />
      <Text style={local.fieldLabel}>Account type</Text>
      <View style={local.typeRow}>
        {ACCOUNT_TYPES.map((option) => (
          <Pressable
            key={option}
            accessibilityRole={'button'}
            accessibilityState={{ selected: props.type === option, disabled: props.busy }}
            disabled={props.busy}
            onPress={() => props.onType(option)}
            style={[local.typeButton, props.type === option && local.typeButtonSelected]}
          >
            <Text style={[local.typeText, props.type === option && local.typeTextSelected]}>{labelType(option)}</Text>
          </Pressable>
        ))}
      </View>
      <Text style={local.fieldLabel}>Opening balance (PKR)</Text>
      <TextInput
        style={local.input}
        value={props.openingBalance}
        onChangeText={props.onOpeningBalance}
        editable={!props.busy}
        keyboardType={'numbers-and-punctuation'}
      />
      <PrimaryButton
        label={props.creating ? 'Creating…' : 'Create account'}
        onPress={props.onCreate}
        disabled={props.busy}
      />
    </Card>
  );
}

type AccountSectionProps = {
  accounts: ManagedAccount[];
  title?: string;
  empty?: string;
  busy: boolean;
  savingKey: string | null;
  renamingId: number | null;
  renamedValue: string;
  onRenameValue(value: string): void;
  onBeginRename(account: ManagedAccount): void;
  onCancelRename(): void;
  onRename(account: ManagedAccount): void;
  onArchive(account: ManagedAccount): void;
  onRestore(account: ManagedAccount): void;
  onDelete(account: ManagedAccount): void;
};

function AccountSection(props: AccountSectionProps) {
  const archived = props.accounts[0]?.archivedAt !== null;
  const title = props.title ?? (archived ? 'Archived' : 'Accounts');
  return (
    <View style={local.section}>
      <SectionTitle>{title}</SectionTitle>
      {props.accounts.length === 0 ? (
        <Card><Text style={local.empty}>{props.empty ?? 'No archived accounts.'}</Text></Card>
      ) : props.accounts.map((account) => (
        <AccountRow key={account.id} account={account} {...props} />
      ))}
    </View>
  );
}

function AccountRow(props: AccountSectionProps & { account: ManagedAccount }) {
  const { account } = props;
  const editing = props.renamingId === account.id;
  const archived = account.archivedAt !== null;
  return (
    <Card>
      <View style={local.accountHeader}>
        <View style={local.accountIdentity}>
          <Text style={local.accountName}>{account.name}</Text>
          <Text style={local.accountType}>{labelType(account.type)} · {archived ? 'Archived' : 'Active'}</Text>
        </View>
        <Text style={local.balance}>{formatPKR(account.balance)}</Text>
      </View>
      {editing ? (
        <View style={local.renameBox}>
          <TextInput
            style={local.input}
            value={props.renamedValue}
            onChangeText={props.onRenameValue}
            editable={!props.busy}
            autoFocus
          />
          <View style={local.actionRow}>
            <Action label={'Save'} disabled={props.busy} onPress={() => props.onRename(account)} />
            <Action label={'Cancel'} disabled={props.busy} onPress={props.onCancelRename} muted />
          </View>
        </View>
      ) : (
        <View style={local.actionRow}>
          {!archived ? <Action label={'Rename'} disabled={props.busy} onPress={() => props.onBeginRename(account)} /> : null}
          {archived ? (
            <Action label={'Restore'} disabled={props.busy} onPress={() => props.onRestore(account)} />
          ) : (
            <Action label={'Archive'} disabled={props.busy} onPress={() => props.onArchive(account)} />
          )}
          <Action label={'Delete'} disabled={props.busy} onPress={() => props.onDelete(account)} danger />
        </View>
      )}
    </Card>
  );
}

function Action(props: {
  label: string;
  disabled: boolean;
  onPress(): void;
  muted?: boolean;
  danger?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole={'button'}
      accessibilityState={{ disabled: props.disabled }}
      disabled={props.disabled}
      onPress={props.onPress}
      style={({ pressed }) => [local.action, props.muted && local.actionMuted, props.danger && local.actionDanger, pressed && local.pressed]}
    >
      <Text style={[local.actionText, props.muted && local.actionTextMuted, props.danger && local.actionTextDanger]}>{props.label}</Text>
    </Pressable>
  );
}

function labelType(type: string) {
  return type.charAt(0).toUpperCase() + type.slice(1);
}

const local = StyleSheet.create({
  flex: { flex: 1 },
  content: { padding: 20, gap: 16, paddingBottom: 48 },
  pad: { padding: 20 },
  eyebrow: { color: palette.primary, fontSize: 13, fontWeight: '800', letterSpacing: 1.2, textTransform: 'uppercase' },
  heroTitle: { color: palette.text, fontSize: 28, lineHeight: 34, fontWeight: '800' },
  heroSubtitle: { color: palette.muted, fontSize: 15, lineHeight: 22 },
  fieldLabel: { color: palette.text, fontSize: 13, fontWeight: '700', marginTop: 4 },
  input: { minHeight: 48, borderWidth: 1, borderColor: palette.border, borderRadius: 12, paddingHorizontal: 14, color: palette.text, backgroundColor: palette.surface },
  typeRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  typeButton: { borderWidth: 1, borderColor: palette.border, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 9 },
  typeButtonSelected: { backgroundColor: palette.primary, borderColor: palette.primary },
  typeText: { color: palette.text, fontWeight: '700' },
  typeTextSelected: { color: palette.surface },
  message: { marginTop: 4 },
  notice: { color: palette.success, fontSize: 14, fontWeight: '700' },
  progress: { color: palette.primary, fontSize: 14, fontWeight: '700' },
  error: { color: palette.danger, fontSize: 14, lineHeight: 20 },
  section: { gap: 10, marginTop: 4 },
  empty: { color: palette.muted, fontSize: 14, lineHeight: 20 },
  accountHeader: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 },
  accountIdentity: { flex: 1, gap: 3 },
  accountName: { color: palette.text, fontSize: 17, fontWeight: '800' },
  accountType: { color: palette.muted, fontSize: 13 },
  balance: { color: palette.text, fontSize: 16, fontWeight: '800' },
  renameBox: { gap: 8 },
  actionRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  action: { borderWidth: 1, borderColor: palette.primary, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8 },
  actionMuted: { borderColor: palette.border },
  actionDanger: { borderColor: palette.danger },
  actionText: { color: palette.primary, fontSize: 13, fontWeight: '800' },
  actionTextMuted: { color: palette.muted },
  actionTextDanger: { color: palette.danger },
  pressed: { opacity: 0.65 },
});
