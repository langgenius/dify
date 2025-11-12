/**
 * Utility for syncing conversation list updates across different pages/tabs
 */

const CONVERSATIONS_UPDATED_KEY = 'conversations_updated'

/**
 * Notify all pages that the conversation list has been updated.
 * This will trigger a refresh of conversation lists in chat components.
 *
 * Use cases:
 * - After deleting conversations
 * - After creating a new conversation
 * - After renaming a conversation
 * - After pinning/unpinning conversations
 * - Any operation that modifies the conversation list
 */
export function notifyConversationListUpdate() {
  localStorage.setItem(CONVERSATIONS_UPDATED_KEY, Date.now().toString())
}

/**
 * Get the timestamp of the last conversation list update
 */
export function getLastConversationUpdateTime(): number | null {
  const timestamp = localStorage.getItem(CONVERSATIONS_UPDATED_KEY)
  return timestamp ? Number.parseInt(timestamp, 10) : null
}
