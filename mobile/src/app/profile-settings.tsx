import { useEffect, useState } from 'react';
import { router } from 'expo-router';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Card, ErrorState, LoadingState, PrimaryButton, Screen, SectionTitle, palette, styles as ui } from '@/components/finance-ui';
import { api } from '@/lib/api';
import { createProfileSettingsController, initialProfileSettingsState } from '@/lib/services/profile-settings-ui';

export default function ProfileSettingsScreen() {
  const [state, setState] = useState(initialProfileSettingsState);
  const [controller] = useState(() => createProfileSettingsController({
    load: api.profileSettings, save: api.saveProfileSettings, changed: setState,
  }));
  useEffect(() => { void controller.load(); }, [controller]);
  if (state.loading) return <Screen><LoadingState /></Screen>;
  if (!state.loaded) return <Screen><View style={local.content}><ErrorState message={state.error ?? 'Settings unavailable.'} retry={() => void controller.load()} /></View></Screen>;
  if (!state.profile) return <Screen><View style={local.content}><Card>
    <SectionTitle>Financial profile not configured</SectionTitle>
    <Text style={ui.muted}>Monthly income and emergency savings target are unavailable, rather than confirmed zero. Recover your profile in Financial Planning, then return to edit it here.</Text>
    <PrimaryButton label="Open Financial Planning" onPress={() => router.replace('/(tabs)/planning')} />
  </Card></View></Screen>;
  return <Screen><KeyboardAvoidingView style={local.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'} keyboardVerticalOffset={90}>
    <ScrollView contentContainerStyle={local.content} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
      <Text style={local.title}>Financial settings</Text>
      <Text style={ui.muted}>Review your saved amounts below. Existing values may include initial app defaults; save the amounts that apply to you.</Text>
      <Card>
        <SectionTitle>Monthly income (PKR)</SectionTitle>
        <Text style={ui.muted}>Your expected monthly income informs the existing risk assessment. Recorded income totals still come from transactions.</Text>
        <TextInput accessibilityLabel="Monthly income in PKR" value={state.monthlyIncome} onChangeText={value => controller.edit('monthlyIncome', value)}
          keyboardType="number-pad" editable={!state.saving} placeholder="Enter whole PKR" placeholderTextColor={palette.muted} style={local.input} />
        <SectionTitle>Emergency savings target (PKR)</SectionTitle>
        <Text style={ui.muted}>Purchase planning reserves the greater of this target and three times average monthly spending. A target is not an account balance or money already saved.</Text>
        <TextInput accessibilityLabel="Emergency savings target in PKR" value={state.emergencyFundTarget} onChangeText={value => controller.edit('emergencyFundTarget', value)}
          keyboardType="number-pad" editable={!state.saving} placeholder="Enter whole PKR" placeholderTextColor={palette.muted} style={local.input} />
        <Text style={ui.muted}>Enter whole PKR digits from 0 to 2,147,483,647. Enter 0 explicitly if the amount is zero; an empty field is not zero.</Text>
        {state.error ? <Text accessibilityRole="alert" style={ui.error}>{state.error}</Text> : null}
        {state.notice ? <Text accessibilityLiveRegion="polite" style={local.success}>{state.notice}</Text> : null}
        <PrimaryButton label={state.saving ? 'Saving…' : 'Save financial settings'} disabled={state.saving} onPress={() => void controller.save()} />
      </Card>
      <Text style={ui.muted}>Changes apply to new calculations. Your transaction history, balances, and financial-history start date stay as saved. Spending forecasts use recorded history, so these settings do not change their estimates.</Text>
    </ScrollView>
  </KeyboardAvoidingView></Screen>;
}
const local = StyleSheet.create({
  flex: { flex: 1 }, content: { padding: 16, gap: 16, paddingBottom: 48 },
  title: { color: palette.text, fontSize: 26, fontWeight: '800' },
  input: { minHeight: 48, padding: 12, borderWidth: 1, borderColor: palette.border, borderRadius: 12,
    backgroundColor: palette.background, color: palette.text, fontSize: 18 },
  success: { color: palette.income, fontSize: 16 },
});
