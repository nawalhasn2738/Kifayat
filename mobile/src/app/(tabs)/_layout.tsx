import { Tabs, router } from 'expo-router';
import { Pressable, StyleSheet, Text } from 'react-native';
import { borders, colors, controlHeights, radii, spacing, typography } from '@/theme/tokens';

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
        headerStyle: { backgroundColor: colors.surface },
        headerTintColor: colors.textPrimary,
        headerTitleStyle: { fontWeight: '700' },
        headerShadowVisible: false,
        sceneStyle: { backgroundColor: colors.canvas },
        tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.border, borderTopWidth: borders.hairline, height: 66 },
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textDisabled,
        tabBarLabelStyle: { ...typography.caption, paddingBottom: spacing.xs },
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
  headerButton: { marginRight: 14, minHeight: controlHeights.minimum, justifyContent: 'center', paddingHorizontal: spacing.md, borderRadius: radii.control, backgroundColor: colors.primary },
  pressed: { backgroundColor: colors.primaryPressed },
  headerButtonText: { color: colors.surface, ...typography.button },
});
