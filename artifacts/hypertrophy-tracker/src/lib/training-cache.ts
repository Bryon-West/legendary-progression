import type { QueryClient } from '@tanstack/react-query';
const apiQuery = (query: { queryKey: readonly unknown[] }) => String(query.queryKey[0]).startsWith('/api/');
export async function refreshTrainingData(client: QueryClient, reset = false) {
  // Stop old responses from repopulating state after a destructive mutation.
  await client.cancelQueries({ predicate: apiQuery });
  if (reset) await client.resetQueries({ predicate: apiQuery });
  else await client.invalidateQueries({ predicate: apiQuery, refetchType: 'active' });
  window.localStorage.setItem('legendary-training-revision', `${Date.now()}-${Math.random()}`);
}
export function mutationError(error: unknown) {
  const data = (error as { data?: { error?: string } })?.data;
  return data?.error ?? (error instanceof Error ? error.message : 'The change could not be saved. Try again when connected.');
}