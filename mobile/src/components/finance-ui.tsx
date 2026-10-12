import type { PropsWithChildren } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

export const palette = {
  background: '#0b0d12',
  card: '#131722',
  border: '#252b3d',
  text: '#f4f4f5',
  muted: '#9ba1b4',
  primary: '#8b72ff',
  success: '#34d399',
  warning: '#fbbf24',
  danger: '#fb7185',
};

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
  return <Pressable accessibilityRole="button" disabled={disabled} onPress={onPress} style={({ pressed }) => [styles.button, (pressed || disabled) && styles.buttonMuted]}><Text style={styles.buttonText}>{label}</Text></Pressable>;
}

export const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: palette.background },
  card: { backgroundColor: palette.card, borderColor: palette.border, borderWidth: 1, borderRadius: 16, padding: 16, gap: 8 },
  sectionTitle: { color: palette.text, fontSize: 18, fontWeight: '700' },
  muted: { color: palette.muted, fontSize: 13, lineHeight: 19 },
  error: { color: palette.danger, fontSize: 16, fontWeight: '700' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  button: { marginTop: 8, minHeight: 46, alignItems: 'center', justifyContent: 'center', borderRadius: 12, backgroundColor: palette.primary, paddingHorizontal: 18 },
  buttonMuted: { opacity: 0.55 },
  buttonText: { color: '#fff', fontWeight: '700', fontSize: 15 },
});
