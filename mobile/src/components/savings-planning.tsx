import { useCallback, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { PrimaryButton, SectionTitle, palette, styles as ui } from './finance-ui';
import { api, formatPKR } from '@/lib/api';
import { createSavingsGoalRunner } from '@/lib/services/savings-goal-ui';
import { assessRecordedInstallment, type SavingsPlanning } from '@/lib/services/savings-planning-core';
import { parseGoalDate, parseGoalTarget } from '@/lib/validation/savings-goal';
import { parsePlanningHorizon } from '@/lib/validation/affordability';
import { reportingCalendarDate } from '@/lib/finance/reporting-calendar';

type Installment = ReturnType<typeof assessRecordedInstallment>;
export function SavingsPlanningSection({ refreshKey }: { refreshKey: string }) {
  const [data, setData] = useState<SavingsPlanning | null>(null);
  const [loading, setLoading] = useState(true), [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null), [notice, setNotice] = useState<string | null>(null);
  const [targets, setTargets] = useState<Record<number, string>>({});
  const [name, setName] = useState(''), [target, setTarget] = useState(''), [date, setDate] = useState('');
  const [showCreate, setShowCreate] = useState(false), [showInstallment, setShowInstallment] = useState(false);
  const [price, setPrice] = useState(''), [months, setMonths] = useState(''), [apr, setApr] = useState('');
  const [installment, setInstallment] = useState<Installment | null>(null), [installmentError, setInstallmentError] = useState<string | null>(null);
  const [runner] = useState(() => createSavingsGoalRunner<SavingsPlanning>({ loading: setLoading, saving: setSaving,
    stale: () => { setData(null); setInstallment(null); },
    loaded: value => { setData(value); setInstallment(null); setInstallmentError(null); }, error: setError, notice: setNotice }));
  const load = useCallback(() => runner.load(api.savingsPlanning), [runner]);
  // A history correction or pull-to-refresh must also refresh this independent workflow.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useFocusEffect(useCallback(() => { void load(); }, [load, refreshKey]));
  async function create() {
    try {
      const input = { name: name.trim(), targetAmount: parseGoalTarget(target), targetDate: parseGoalDate(date) };
      if (!input.name) throw new Error('Enter a goal name.');
      const result = await runner.submit(() => api.createGoal(input), api.savingsPlanning);
      if (result === 'saved' || result === 'saved_refresh_failed') { setName(''); setTarget(''); setDate(''); setShowCreate(false); }
    } catch (caught) { setNotice(null); setError(caught instanceof Error ? caught.message : 'Check the goal values.'); }
  }
  async function update(id: number, currentTarget: number) {
    try {
      const amount = parseGoalTarget(targets[id] ?? String(currentTarget));
      const result = await runner.submit(() => api.updateGoalTarget(id, amount), api.savingsPlanning);
      if (result === 'saved' || result === 'saved_refresh_failed') setTargets(previous => { const next = { ...previous }; delete next[id]; return next; });
    } catch (caught) { setNotice(null); setError(caught instanceof Error ? caught.message : 'Check the target.'); }
  }
  function checkInstallment() {
    setInstallment(null); setInstallmentError(null);
    try {
      if (!data || loading || saving) throw new Error('Refresh savings planning first.');
      if (!/^\d+(?:\.\d{1,2})?$/.test(apr)) throw new Error('Enter APR as a percentage from 0 to 100; enter 0 explicitly if interest-free.');
      setInstallment(assessRecordedInstallment(data, { price: parseGoalTarget(price), months: parsePlanningHorizon(months), apr: Number(apr) / 100 }));
    } catch (caught) { setInstallmentError(caught instanceof Error ? caught.message : 'Check the installment inputs.'); }
  }
  const busy = saving || loading;
  return <View style={local.section}>
    <SectionTitle>Savings goals</SectionTitle>
    {loading ? <Text accessibilityLiveRegion="polite" style={ui.muted}>Loading savings planning…</Text> : null}
    {!data && !loading ? <PrimaryButton label="Retry savings planning" onPress={() => void load()} /> : null}
    {data ? <>
      <Text style={ui.muted}>{data.progressReason}</Text>
      <Text style={ui.muted}>Every goal compares against the same shared pool. Do not add these figures together or treat them as allocated money. Your emergency reserve setting is separate.</Text>
      {!data.goals.length ? <Text style={ui.muted}>No savings goal is configured. Add a goal and target below.</Text> : null}
      {data.goals.map(goal => <View key={goal.id} style={local.goal}>
        <Text style={local.name}>{goal.name}</Text>
        <Text style={ui.muted}>Target date {reportingCalendarDate(goal.targetDate)} · target {formatPKR(goal.targetAmount)}</Text>
        {goal.progress.current !== null ? <>
          <Text style={local.amount}>Recorded net savings: {formatPKR(goal.progress.current)}</Text>
          {goal.progress.netSavings! < 0 ? <Text style={ui.muted}>Recorded net deficit: {formatPKR(goal.progress.netSavings!)}. No positive savings progress.</Text> : null}
          <Text style={ui.muted}>Remaining {formatPKR(goal.progress.remaining!)} · {Math.floor(goal.progress.percent!)}% of target</Text>
          <View accessible accessibilityRole="progressbar" accessibilityLabel={`${goal.name} recorded net savings progress`} accessibilityValue={{ min: 0, max: 100, now: Math.floor(goal.progress.percent!) }} style={local.track}>
            <View style={[local.bar, { width: `${goal.progress.percent}%` }]} />
          </View>
        </> : <Text style={ui.muted}>Progress and remaining amount are unavailable until complete history is confirmed.</Text>}
        <Text style={ui.muted}>Previously recorded for this goal: {formatPKR(goal.currentAmount)}. This amount is shown separately and is not added to recorded net savings.</Text>
        <TextInput accessibilityLabel={`${goal.name} target in PKR`} editable={!busy} keyboardType="number-pad" value={targets[goal.id] ?? String(goal.targetAmount)}
          onChangeText={value => { setTargets(previous => ({ ...previous, [goal.id]: value })); setNotice(null); }} style={local.input} />
        <PrimaryButton label={saving ? 'Saving…' : 'Save target'} disabled={busy} onPress={() => void update(goal.id, goal.targetAmount)} />
      </View>)}
      <Pressable accessibilityRole="button" accessibilityState={{ expanded: showCreate }} disabled={busy} onPress={() => setShowCreate(value => !value)} style={local.toggle}><Text style={local.link}>{showCreate ? 'Close new goal' : 'Add savings goal'}</Text></Pressable>
      {showCreate ? <View style={local.form}>
        <Text style={ui.muted}>Goal targets must be positive whole PKR amounts. A target does not move or reserve money.</Text>
        <TextInput accessibilityLabel="New goal name" placeholder="Goal name" placeholderTextColor={palette.muted} value={name} onChangeText={setName} maxLength={100} editable={!busy} style={local.input} />
        <TextInput accessibilityLabel="New goal target in PKR" placeholder="Target in PKR" placeholderTextColor={palette.muted} value={target} onChangeText={setTarget} keyboardType="number-pad" editable={!busy} style={local.input} />
        <TextInput accessibilityLabel="New goal target date" placeholder="YYYY-MM-DD (Karachi)" placeholderTextColor={palette.muted} value={date} onChangeText={setDate} editable={!busy} style={local.input} />
        <PrimaryButton label={saving ? 'Saving…' : 'Create goal'} disabled={busy} onPress={() => void create()} />
      </View> : null}
      <SectionTitle>Savings recommendation</SectionTitle>
      {data.analysis.status === 'ready' ? <>
        <Text style={local.amount}>Up to {formatPKR(data.analysis.recommendation.recommendedMonthlyTransfer)} / month to consider saving</Text>
        <Text style={ui.muted}>{data.analysis.recommendation.reason}</Text>
        <Text style={ui.muted}>Based on recorded average income {formatPKR(data.analysis.income)} and expenses {formatPKR(data.analysis.expectedExpenses)} for complete Karachi months {data.analysis.qualifyingMonths.join(', ')}. Eligible empty months count as zero; the current partial month is excluded.</Text>
        {data.analysis.patterns.map(pattern => <Text key={pattern.name} style={ui.muted}>Review {pattern.name.replaceAll('_', ' ')}: {formatPKR(pattern.total)} recorded across these months.</Text>)}
        {!data.analysis.patterns.length ? <Text style={ui.muted}>No expenses recorded in these confirmed complete months.</Text> : null}
        <Text style={ui.muted}>The existing 20% rule is capped by recorded income minus expenses. These are estimates to review, not guaranteed savings or an automatic transfer. No particular category reduction is assumed.</Text>
      </> : <Text style={ui.muted}>{data.analysis.guidance}</Text>}
      <Pressable accessibilityRole="button" accessibilityState={{ expanded: showInstallment }} onPress={() => setShowInstallment(value => !value)} style={local.toggle}><Text style={local.link}>Installment calculation {showInstallment ? '−' : '+'}</Text></Pressable>
      {showInstallment ? <View style={local.form}>
        <Text style={ui.muted}>Compare a payment against the existing 30% of disposable-income rule. This is arithmetic using recorded averages, not a credit offer or approval.</Text>
        <TextInput accessibilityLabel="Installment price in PKR" placeholder="Price in PKR" placeholderTextColor={palette.muted} keyboardType="number-pad" value={price} onChangeText={value => { setPrice(value); setInstallment(null); }} style={local.input} />
        <TextInput accessibilityLabel="Installment months" placeholder="Months (1–120)" placeholderTextColor={palette.muted} keyboardType="number-pad" value={months} onChangeText={value => { setMonths(value); setInstallment(null); }} style={local.input} />
        <TextInput accessibilityLabel="Installment APR percent" placeholder="APR % (0–100)" placeholderTextColor={palette.muted} keyboardType="decimal-pad" value={apr} onChangeText={value => { setApr(value); setInstallment(null); }} style={local.input} />
        <PrimaryButton label="Calculate installment" disabled={busy} onPress={checkInstallment} />
        {installmentError ? <Text accessibilityRole="alert" style={ui.error}>{installmentError}</Text> : null}
        {installment ? <><Text style={local.amount}>Estimated payment {formatPKR(installment.monthly)} / month</Text><Text style={ui.muted}>{installment.reason}</Text><Text style={ui.muted}>Income basis: recorded complete-month average. Essential expenses are subtracted before applying the rule. Fees and unrecorded obligations are excluded; passing this rule does not guarantee affordability. No money was moved.</Text></> : null}
      </View> : null}
    </> : null}
    {error ? <Text accessibilityRole="alert" style={ui.error}>{error}</Text> : null}
    {notice ? <Text accessibilityLiveRegion="polite" style={local.success}>{notice}</Text> : null}
    {data && !loading ? <PrimaryButton label="Refresh savings planning" disabled={saving} onPress={() => void load()} /> : null}
  </View>;
}
const local = StyleSheet.create({
  section: { gap: 12, paddingVertical: 16, borderTopWidth: 1, borderColor: palette.border },
  goal: { gap: 8, paddingVertical: 14, borderBottomWidth: 1, borderColor: palette.border },
  name: { color: palette.text, fontSize: 18, fontWeight: '700' }, amount: { color: palette.text, fontSize: 16, fontWeight: '700' },
  form: { gap: 10 }, input: { minHeight: 48, color: palette.text, backgroundColor: palette.background, borderWidth: 1, borderColor: palette.border, borderRadius: 10, padding: 12 },
  track: { height: 10, borderRadius: 5, overflow: 'hidden', backgroundColor: palette.border }, bar: { height: '100%', backgroundColor: palette.primary },
  toggle: { minHeight: 48, justifyContent: 'center' }, link: { color: palette.primary, fontWeight: '700', fontSize: 16 }, success: { color: palette.income, fontSize: 14 },
});
