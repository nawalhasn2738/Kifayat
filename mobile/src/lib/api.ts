import type { Account, Affordability, Category, Forecast, Risk, Summary, Transaction } from './types';

const configuredUrl = process.env.EXPO_PUBLIC_API_URL?.trim();
export const API_URL = (configuredUrl || 'http://192.168.1.5:3000').replace(/\/$/, '');

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const message = body && typeof body.error === 'string' ? body.error : `Request failed (${response.status})`;
    throw new Error(message);
  }
  return body as T;
}

export const api = {
  summary: () => request<Summary>('/api/summary'),
  risk: () => request<Risk>('/api/risk'),
  forecast: () => request<Forecast>('/api/forecast'),
  categories: () => request<Category[]>('/api/categories'),
  accounts: () => request<Account[]>('/api/accounts'),
  transactions: (page = 1, pageSize = 25) =>
    request<{ items: Transaction[]; total: number; page: number; pageSize: number }>(
      `/api/transactions?page=${page}&pageSize=${pageSize}`,
    ),
  transaction: (id: number) => request<Transaction>(`/api/transactions/${id}`),
  createTransaction: (input: {
    date: string;
    amount: number;
    type: 'income' | 'expense';
    categoryId: number | null;
    accountId: number;
    merchant: string | null;
    description: string | null;
  }) => request<Transaction>('/api/transactions', { method: 'POST', body: JSON.stringify(input) }),
  affordability: (input: { itemName: string; price: number; monthsAhead: number }) =>
    request<Affordability>('/api/affordability', { method: 'POST', body: JSON.stringify(input) }),
  chat: (messages: { role: 'user' | 'assistant'; content: string }[]) =>
    request<{ text: string }>('/api/mobile-chat', { method: 'POST', body: JSON.stringify({ messages }) }),
};

export const formatPKR = (value: number) =>
  `PKR ${Math.abs(Math.round(value)).toLocaleString('en-PK')}`;
