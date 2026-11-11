import { useEffect, useRef, useState } from 'react';
import { FlatList, KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Screen, palette, styles as ui } from '@/components/finance-ui';
import { api } from '@/lib/api';
import { getOrCreateConversation, listMessages, saveMessage } from '@/lib/repositories/chat';
import { createChatSession, initialChatState, type SessionMessage } from '@/lib/services/chat-session-core';

const suggestions = ['How much did I spend this month?', 'What is my biggest spending category?', 'How much did I save this month?', 'How much income did I receive?', 'How much did I spend on groceries?', 'Compare my spending with the previous complete month.'];

export default function ChatScreen() {
  const [state, setState] = useState(initialChatState);
  const { messages, loading, error } = state;
  const [input, setInput] = useState('');
  const list = useRef<FlatList<SessionMessage>>(null);
  const [session] = useState(() => createChatSession({ getOrCreateConversation, listMessages, saveMessage, chat: api.chat, changed: setState }));

  useEffect(() => {
    void session.load();
  }, [session]);

  async function send(content = input) {
    if (!content.trim() || loading || !state.ready || state.retryable) return;
    setInput('');
    await session.send(content);
    list.current?.scrollToEnd({ animated: true });
  }

  const disabled = loading || !state.ready || state.retryable;
  return <Screen><KeyboardAvoidingView style={local.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'} keyboardVerticalOffset={90}>
    <Text style={[ui.muted, local.notice]}>Answers use your local recorded totals. With an AI endpoint configured, recent messages and monthly aggregates are sent to that service; individual transactions stay on your device.</Text>
    <FlatList ref={list} data={messages} keyExtractor={(item) => item.id} contentContainerStyle={local.messages} keyboardShouldPersistTaps="handled" ListEmptyComponent={<View style={local.empty}><Text style={local.spark}>✦</Text><Text style={local.title}>Ask Kifayat</Text><Text style={[ui.muted, local.center]}>Ask about recorded income, spending, categories, or savings this month and last month.</Text><View style={local.suggestions}>{suggestions.map((text) => <Pressable disabled={disabled} accessibilityRole="button" key={text} onPress={() => send(text)} style={local.suggestion}><Text style={local.suggestionText}>{text}</Text></Pressable>)}</View></View>} renderItem={({ item }) => <View style={[local.bubble, item.role === 'user' ? local.userBubble : local.assistantBubble]}><Text style={local.messageText}>{item.content}</Text></View>} ListFooterComponent={loading ? <View style={[local.bubble, local.assistantBubble]}><Text style={ui.muted}>{state.ready ? 'Kifayat is thinking…' : 'Loading conversation…'}</Text></View> : error ? <View><Text accessibilityRole="alert" style={ui.error}>{error}</Text><Pressable accessibilityRole="button" onPress={() => void (state.ready ? session.retry() : session.load())} style={local.suggestion}><Text style={local.suggestionText}>Try again</Text></Pressable></View> : state.mode === 'deterministic' ? <Text style={ui.muted}>Answered from local calculations; AI wording was not used.</Text> : null} />
    <View style={local.composer}><TextInput accessibilityLabel="Message Kifayat" value={input} onChangeText={setInput} maxLength={2000} onSubmitEditing={() => send()} editable={!disabled} placeholder="Ask about your finances…" placeholderTextColor={palette.muted} style={local.input} returnKeyType="send" /><Pressable accessibilityRole="button" accessibilityLabel="Send message" disabled={disabled || !input.trim()} onPress={() => send()} style={[local.send, (disabled || !input.trim()) && local.disabled]}><Text style={local.sendText}>↑</Text></Pressable></View>
  </KeyboardAvoidingView></Screen>;
}

const local = StyleSheet.create({
  notice: { paddingHorizontal: 16, paddingTop: 8, fontSize: 11 },
  flex: { flex: 1 }, messages: { padding: 16, gap: 12, flexGrow: 1 }, empty: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 60, gap: 10 }, spark: { color: palette.primary, fontSize: 40 }, title: { color: palette.text, fontSize: 28, fontWeight: '800' }, center: { textAlign: 'center', maxWidth: 300 }, suggestions: { width: '100%', gap: 8, marginTop: 10 }, suggestion: { borderColor: palette.border, borderWidth: 1, backgroundColor: palette.card, borderRadius: 14, padding: 13 }, suggestionText: { color: palette.text, textAlign: 'center' },
  bubble: { maxWidth: '86%', borderRadius: 18, padding: 14 }, userBubble: { backgroundColor: palette.primary, alignSelf: 'flex-end', borderBottomRightRadius: 5 }, assistantBubble: { backgroundColor: palette.card, borderColor: palette.border, borderWidth: 1, alignSelf: 'flex-start', borderBottomLeftRadius: 5 }, messageText: { color: palette.text, fontSize: 15, lineHeight: 22 },
  composer: { flexDirection: 'row', gap: 8, padding: 12, borderTopColor: palette.border, borderTopWidth: 1, backgroundColor: palette.background }, input: { flex: 1, minHeight: 48, color: palette.text, backgroundColor: palette.card, borderColor: palette.border, borderWidth: 1, borderRadius: 16, paddingHorizontal: 14 }, send: { width: 48, height: 48, borderRadius: 16, backgroundColor: palette.primary, alignItems: 'center', justifyContent: 'center' }, disabled: { opacity: 0.45 }, sendText: { color: '#fff', fontSize: 24, fontWeight: '800' },
});
