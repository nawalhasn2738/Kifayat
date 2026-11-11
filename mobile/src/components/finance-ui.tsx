import type { PropsWithChildren } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { borders, colors, controlHeights, elevation, radii, spacing, typography } from '@/theme/tokens';

export const palette = {
  ...colors,
  background: colors.canvas,
  card: colors.surface,
  text: colors.textPrimary,
  muted: colors.textSecondary,
  success: colors.income,
  danger: colors.error,
} as const;

export function Screen({ children }: PropsWithChildren) {
  return <View style={styles.screen}>{children}</View>;
}

export function Card({ children }: PropsWithChildren) {
  return <View style={styles.card}>{children}</View>;
}

export function SectionTitle({ children }: PropsWithChildren) {
  return <Text style={styles.sectionTitle}>{children}</Text>;
}

export function LoadingState() {
  return <View style={styles.center}><ActivityIndicator color={palette.primary} size="large" /><Text style={styles.muted}>Loading…</Text></View>;
}

export function ErrorState({ message, retry }: { message: string; retry: () => void }) {
  return <Card><Text style={styles.error}>Could not load data</Text><Text style={styles.muted}>{message}</Text><PrimaryButton label="Try again" onPress={retry} /></Card>;
}

export function PrimaryButton({ label, onPress, disabled = false }: { label: string; onPress: () => void; disabled?: boolean }) {
  return <Pressable accessibilityRole="button" accessibilityState={{ disabled }} disabled={disabled} onPress={onPress} style={({ pressed }) => [styles.button, pressed && !disabled && styles.buttonPressed, disabled && styles.buttonDisabled]}><Text style={[styles.buttonText, disabled && styles.buttonTextDisabled]}>{label}</Text></Pressable>;
}

export const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: palette.background },
  card: { ...elevation.raised, backgroundColor: palette.card, borderColor: palette.border, borderWidth: borders.hairline, borderRadius: radii.surface, padding: spacing.lg, gap: spacing.sm },
  sectionTitle: { color: palette.text, ...typography.sectionTitle },
  muted: { color: palette.muted, ...typography.supporting },
  error: { color: palette.danger, fontSize: 16, fontWeight: '700' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.md },
  button: { marginTop: spacing.sm, minHeight: controlHeights.standard, alignItems: 'center', justifyContent: 'center', borderRadius: radii.control, backgroundColor: palette.primary, paddingHorizontal: 18 },
  buttonPressed: { backgroundColor: palette.primaryPressed },
  buttonDisabled: { backgroundColor: palette.surfaceMuted, borderColor: palette.border, borderWidth: borders.hairline },
  buttonText: { color: palette.surface, ...typography.button },
  buttonTextDisabled: { color: palette.textDisabled },
});
