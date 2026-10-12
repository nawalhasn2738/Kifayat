import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';

const headerOptions = {
  headerStyle: { backgroundColor: '#0b0d12' },
  headerTintColor: '#f4f4f5',
  headerTitleStyle: { fontWeight: '700' as const },
  contentStyle: { backgroundColor: '#0b0d12' },
};

export default function RootLayout() {
  return (
    <>
      <StatusBar style="light" />
      <Stack screenOptions={headerOptions}>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="add-transaction" options={{ title: 'Add Transaction' }} />
        <Stack.Screen name="transaction/[id]" options={{ title: 'Transaction Details' }} />
      </Stack>
    </>
  );
}
