import { useRef, useState } from 'react';
import { FlatList, KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Screen, palette, styles as ui } from '@/components/finance-ui';
import { api } from '@/lib/api';

type Message = { id: string; role: 'user' | 'assistant'; content: string };
const suggestions = ['How risky is my spending?', 'Can I afford an iPhone?', 'What will I spend next month?'];

export default function ChatScreen() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const list = useRef<FlatList<Message>>(null);
  const idSequence = useRef(0);

  async function send(content = input) {
    const trimmed = content.trim();
    if (!trimmed || loading) return;
    const user: Message = { id: `${++idSequence.current}-u`, role: 'user', content: trimmed };
    const next = [...messages, user];
    setMessages(next); setInput(''); setLoading(true); setError(null);
    try {
      const response = await api.chat(next.map(({ role, content: text }) => ({ role, content: text })));
      setMessages((current) => [...current, { id: `${++idSequence.current}-a`, role: 'assistant', content: response.text }]);
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Chat failed'); }
    finally { setLoading(false); setTimeout(() => list.current?.scrollToEnd({ animated: true }), 50); }
  }

  return <Screen><KeyboardAvoidingView style={local.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={90}>
    <FlatList ref={list} data={messages} keyExtractor={(item) => item.id} contentContainerStyle={local.messages} keyboardShouldPersistTaps="handled" ListEmptyComponent={<View style={local.empty}><Text style={local.spark}>✦</Text><Text style={local.title}>Ask Kifayat</Text><Text style={[ui.muted, local.center]}>Ask about spending, risk, saving, affordability, or your forecast.</Text><View style={local.suggestions}>{suggestions.map((text) => <Pressable accessibilityRole="button" key={text} onPress={() => send(text)} style={local.suggestion}><Text style={local.suggestionText}>{text}</Text></Pressable>)}</View></View>} renderItem={({ item }) => <View style={[local.bubble, item.role === 'user' ? local.userBubble : local.assistantBubble]}><Text style={local.messageText}>{item.content}</Text></View>} ListFooterComponent={loading ? <View style={[local.bubble, local.assistantBubble]}><Text style={ui.muted}>Kifayat is thinking…</Text></View> : error ? <Text accessibilityRole="alert" style={ui.error}>{error}</Text> : null} />
    <View style={local.composer}><TextInput accessibilityLabel="Message Kifayat" value={input} onChangeText={setInput} onSubmitEditing={() => send()} editable={!loading} placeholder="Ask about your finances…" placeholderTextColor={palette.muted} style={local.input} returnKeyType="send" /><Pressable accessibilityRole="button" accessibilityLabel="Send message" disabled={loading || !input.trim()} onPress={() => send()} style={[local.send, (loading || !input.trim()) && local.disabled]}><Text style={local.sendText}>↑</Text></Pressable></View>
  </KeyboardAvoidingView></Screen>;
}

const local = StyleSheet.create({
  flex: { flex: 1 }, messages: { padding: 16, gap: 12, flexGrow: 1 }, empty: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 60, gap: 10 }, spark: { color: palette.primary, fontSize: 40 }, title: { color: palette.text, fontSize: 28, fontWeight: '800' }, center: { textAlign: 'center', maxWidth: 300 }, suggestions: { width: '100%', gap: 8, marginTop: 10 }, suggestion: { borderColor: palette.border, borderWidth: 1, backgroundColor: palette.card, borderRadius: 14, padding: 13 }, suggestionText: { color: palette.text, textAlign: 'center' },
  bubble: { maxWidth: '86%', borderRadius: 18, padding: 14 }, userBubble: { backgroundColor: palette.primary, alignSelf: 'flex-end', borderBottomRightRadius: 5 }, assistantBubble: { backgroundColor: palette.card, borderColor: palette.border, borderWidth: 1, alignSelf: 'flex-start', borderBottomLeftRadius: 5 }, messageText: { color: palette.text, fontSize: 15, lineHeight: 22 },
  composer: { flexDirection: 'row', gap: 8, padding: 12, borderTopColor: palette.border, borderTopWidth: 1, backgroundColor: palette.background }, input: { flex: 1, minHeight: 48, color: palette.text, backgroundColor: palette.card, borderColor: palette.border, borderWidth: 1, borderRadius: 16, paddingHorizontal: 14 }, send: { width: 48, height: 48, borderRadius: 16, backgroundColor: palette.primary, alignItems: 'center', justifyContent: 'center' }, disabled: { opacity: 0.45 }, sendText: { color: '#fff', fontSize: 24, fontWeight: '800' },
});
