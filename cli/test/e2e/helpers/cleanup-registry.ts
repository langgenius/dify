/**
 * E2E cleanup registry.
 *
 * Test suites call `registerConversation(host, token, appId, conversationId)`
 * whenever a real conversation is created on staging.  The global teardown
 * iterates the registry and deletes all collected conversations so staging
 * data stays clean between CI runs.
 *
 * Design notes:
 *  - Uses a module-level array (shared within the same worker process).
 *  - vitest runs E2E suites in a single fork (fileParallelism: false), so one
 *    process owns the full registry.
 *  - Deletion is best-effort: individual failures are logged but do not throw.
 */

export type ConversationEntry = {
  host: string
  token: string
  appId: string
  conversationId: string
}

const _conversations: ConversationEntry[] = []

/**
 * Register a conversation for cleanup in teardown.
 * Call this whenever `run app` returns a `conversation_id`.
 */
export function registerConversation(
  host: string,
  token: string,
  appId: string,
  conversationId: string,
): void {
  if (!conversationId || !appId)
    return
  _conversations.push({ host, token, appId, conversationId })
}

/**
 * Return all registered conversations (for use in teardown).
 */
export function getRegisteredConversations(): readonly ConversationEntry[] {
  return _conversations
}

/**
 * Delete all registered conversations from the staging server.
 * Called once from global-teardown.ts.
 */
export async function cleanupRegisteredConversations(): Promise<void> {
  if (_conversations.length === 0)
    return

  console.warn(`[E2E teardown] Cleaning up ${_conversations.length} staged conversation(s)…`)

  const results = await Promise.allSettled(
    _conversations.map(({ host, token, appId, conversationId }) =>
      deleteConversation(host, token, appId, conversationId),
    ),
  )

  const failed = results.filter(r => r.status === 'rejected')
  if (failed.length > 0) {
    console.warn(
      `[E2E teardown] ${failed.length} conversation deletion(s) failed (non-blocking):`,
      failed.map(r => (r as PromiseRejectedResult).reason).join(', '),
    )
  }
  else {
    console.warn(`[E2E teardown] All conversations cleaned up.`)
  }

  _conversations.length = 0
}

async function deleteConversation(
  host: string,
  token: string,
  appId: string,
  conversationId: string,
): Promise<void> {
  const url = `${host.replace(/\/$/, '')}/openapi/v1/apps/${appId}/conversations/${conversationId}`
  const res = await fetch(url, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(8_000),
  })
  // 404 is acceptable — conversation may have already been cleaned up
  if (!res.ok && res.status !== 404) {
    throw new Error(`DELETE ${url} → HTTP ${res.status}`)
  }
}
