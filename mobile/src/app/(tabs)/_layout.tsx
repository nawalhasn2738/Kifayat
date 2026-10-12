import { Tabs, router } from 'expo-router';
import { Pressable, StyleSheet, Text } from 'react-native';

const icons: Record<string, string> = {
  index: '⌂',
  transactions: '↕',
  planning: '◎',
  chat: '✦',
};

export default function TabLayout() {
  return (
    <Tabs
      screenOptions={({ route }) => ({
        headerStyle: { backgroundColor: '#0b0d12' },
        headerTintColor: '#f4f4f5',
        headerTitleStyle: { fontWeight: '700' },
        sceneStyle: { backgroundColor: '#0b0d12' },
        tabBarStyle: { backgroundColor: '#131722', borderTopColor: '#252b3d', height: 66 },
        tabBarActiveTintColor: '#8b72ff',
        tabBarInactiveTintColor: '#8b90a3',
        tabBarLabelStyle: { fontSize: 11, paddingBottom: 5 },
        tabBarIcon: ({ color }) => (
          <Text style={{ color, fontSize: 20 }}>{icons[route.name] ?? '•'}</Text>
        ),
      })}>
      <Tabs.Screen name="index" options={{ title: 'Overview', headerTitle: 'Kifayat' }} />
      <Tabs.Screen
        name="transactions"
        options={{
          title: 'Transactions',
          headerRight: () => (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Add transaction"
              onPress={() => router.push('/add-transaction')}
              style={({ pressed }) => [styles.headerButton, pressed && styles.pressed]}>
              <Text style={styles.headerButtonText}>Add</Text>
            </Pressable>
          ),
        }}
      />
      <Tabs.Screen name="planning" options={{ title: 'Planning', headerTitle: 'Financial Planning' }} />
      <Tabs.Screen name="chat" options={{ title: 'Kifayat Chat', headerTitle: 'Ask Kifayat' }} />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  headerButton: { marginRight: 14, minHeight: 36, justifyContent: 'center', paddingHorizontal: 12, borderRadius: 10, backgroundColor: '#8b72ff' },
  pressed: { opacity: 0.65 },
  headerButtonText: { color: '#fff', fontWeight: '800' },
});
