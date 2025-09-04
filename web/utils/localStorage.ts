import { CONVERSATION_ID_INFO } from '@/config'

/**
 * Utility functions for managing conversation IDs in localStorage
 */

export type ConversationIdInfo = {
  [appId: string]: {
    [userId: string]: string
  }
}

/**
 * Clear conversation IDs from localStorage to prevent 404 errors
 * @param appId - Optional specific app ID to clear. If not provided, clears all conversation IDs
 * @param options - Additional options for clearing behavior
 */
export function clearConversationIds(
  appId?: string,
  options: {
    /** Clear all conversation IDs regardless of appId */
    clearAll?: boolean
    /** Enable debug logging */
    debug?: boolean
  } = {},
): boolean {
  if (typeof window === 'undefined')
    return false

  const { clearAll = true, debug = true } = options

  try {
    const conversationIdInfo: ConversationIdInfo = JSON.parse(
      localStorage.getItem(CONVERSATION_ID_INFO) || '{}',
    )

    let cleared = false

    // Clear specific app ID if provided
    if (appId && conversationIdInfo[appId]) {
      delete conversationIdInfo[appId]
      cleared = true
      if (debug)
        console.log(`✅ Cleared conversation ID info for app ${appId}`)
    }

    // Clear all conversation IDs to prevent explore page 404 errors
    if (clearAll) {
      const keysToDelete = Object.keys(conversationIdInfo)
      if (keysToDelete.length > 0) {
        keysToDelete.forEach((key) => {
          delete conversationIdInfo[key]
          if (debug)
            console.log(`🧹 Cleared conversation ID for ${key} to prevent 404 errors`)
        })
        cleared = true
      }
    }

    // Update localStorage and dispatch event if changes were made
    if (cleared) {
      const newValue = JSON.stringify(conversationIdInfo)
      localStorage.setItem(CONVERSATION_ID_INFO, newValue)

      // Dispatch storage event for cross-tab synchronization
      window.dispatchEvent(new StorageEvent('storage', {
        key: CONVERSATION_ID_INFO,
        newValue,
        storageArea: localStorage,
      }))

      if (debug)
        console.log('📱 localStorage conversation IDs updated and storage event dispatched')
    }

    return cleared
  }
  catch (error) {
    console.error('Failed to clear conversation IDs from localStorage:', error)
    return false
  }
}

/**
 * Get conversation ID for a specific app and user
 */
export function getConversationId(appId: string, userId = 'DEFAULT'): string {
  if (typeof window === 'undefined')
    return ''

  try {
    const conversationIdInfo: ConversationIdInfo = JSON.parse(
      localStorage.getItem(CONVERSATION_ID_INFO) || '{}',
    )

    return conversationIdInfo[appId]?.[userId] || ''
  }
  catch (error) {
    console.error('Failed to get conversation ID from localStorage:', error)
    return ''
  }
}

/**
 * Set conversation ID for a specific app and user
 */
export function setConversationId(appId: string, conversationId: string, userId = 'DEFAULT'): boolean {
  if (typeof window === 'undefined')
    return false

  try {
    const conversationIdInfo: ConversationIdInfo = JSON.parse(
      localStorage.getItem(CONVERSATION_ID_INFO) || '{}',
    )

    if (!conversationIdInfo[appId])
      conversationIdInfo[appId] = {}

    conversationIdInfo[appId][userId] = conversationId

    const newValue = JSON.stringify(conversationIdInfo)
    localStorage.setItem(CONVERSATION_ID_INFO, newValue)

    // Dispatch storage event for cross-tab synchronization
    window.dispatchEvent(new StorageEvent('storage', {
      key: CONVERSATION_ID_INFO,
      newValue,
      storageArea: localStorage,
    }))

    return true
  }
  catch (error) {
    console.error('Failed to set conversation ID in localStorage:', error)
    return false
  }
}
