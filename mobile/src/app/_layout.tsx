import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { useMigrations } from 'drizzle-orm/expo-sqlite/migrator';
import migrations from '../../drizzle/migrations';
import { configureDatabase, db } from '@/lib/db/client';
import { seedLocalProfile } from '@/lib/db/seed';
import { colors, spacing, typography } from '@/theme/tokens';

const headerOptions = {
  headerStyle: { backgroundColor: colors.surface },
  headerTintColor: colors.textPrimary,
  headerTitleStyle: { fontWeight: '700' as const },
  headerShadowVisible: false,
  contentStyle: { backgroundColor: colors.canvas },
};

export default function RootLayout() {
  const migration = useMigrations(db, migrations);
  const [ready, setReady] = useState(false);
  const [setupError, setSetupError] = useState<Error | null>(null);

  useEffect(() => {
    if (!migration.success) return;
    void configureDatabase()
      .then(() => seedLocalProfile(db))
      .then(() => setReady(true))
      .catch((error) => setSetupError(error instanceof Error ? error : new Error('Database setup failed.')));
  }, [migration.success]);

  const databaseError = migration.error ?? setupError;
  if (databaseError) return <View style={startup.center}><Text accessibilityRole={'alert'} style={startup.error}>Kifayat could not open its local database.</Text><Text style={startup.detail}>{databaseError.message}</Text></View>;
  if (!ready) return <View style={startup.center}><ActivityIndicator color={colors.primary} /><Text style={startup.detail}>Preparing your private local data...</Text></View>;
  return (
    <>
      <StatusBar style="dark" />
      <Stack screenOptions={headerOptions}>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="add-transaction" options={{ title: 'Add Transaction' }} />
        <Stack.Screen name="transaction/[id]" options={{ title: 'Transaction Details' }} />
        <Stack.Screen name={'add-transfer'} options={{ title: 'Transfer Money' }} />
        <Stack.Screen name={'transfer/[id]'} options={{ title: 'Transfer Details' }} />
      </Stack>
    </>
  );
}

const startup = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.md, padding: spacing.xxl, backgroundColor: colors.canvas },
  error: { color: colors.error, fontSize: 17, lineHeight: 23, fontWeight: '700', textAlign: 'center' },
  detail: { color: colors.textSecondary, textAlign: 'center', ...typography.body },
});
