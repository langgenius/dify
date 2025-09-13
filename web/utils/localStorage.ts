import { CONVERSATION_ID_INFO } from '@/app/components/base/chat/constants'

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
 * @param appId - Specific app ID to clear. If not provided, no changes will be made
 * @param options - Additional options for clearing behavior
 */
export function clearConversationIds(
  appId: string,
  options: {
    /** Clear related app IDs (e.g., different instances of the same app) */
    clearRelated?: string[]
    /** Force clear all conversation IDs (use with caution) */
    forceGlobalClear?: boolean
    /** Enable debug logging */
    debug?: boolean
  } = {},
): boolean {
  if (typeof window === 'undefined')
    return false

  const { clearRelated = [], forceGlobalClear = false, debug = true } = options

  try {
    const conversationIdInfo: ConversationIdInfo = JSON.parse(
      localStorage.getItem(CONVERSATION_ID_INFO) || '{}',
    )

    let cleared = false
    const clearedApps: string[] = []

    // Clear specific app ID
    if (conversationIdInfo[appId]) {
      delete conversationIdInfo[appId]
      cleared = true
      clearedApps.push(appId)
      if (debug)
        console.log(`✅ Cleared conversation ID info for app ${appId}`)
    }

    // Clear related app IDs if specified
    if (clearRelated.length > 0) {
      clearRelated.forEach((relatedAppId) => {
        if (conversationIdInfo[relatedAppId]) {
          delete conversationIdInfo[relatedAppId]
          cleared = true
          clearedApps.push(relatedAppId)
          if (debug)
            console.log(`🔗 Cleared related conversation ID for app ${relatedAppId}`)
        }
      })
    }

    // Force clear all conversation IDs (only if explicitly requested)
    if (forceGlobalClear) {
      const keysToDelete = Object.keys(conversationIdInfo)
      if (keysToDelete.length > 0) {
        keysToDelete.forEach((key) => {
          delete conversationIdInfo[key]
          if (!clearedApps.includes(key))
            clearedApps.push(key)
        })
        cleared = true
        if (debug)
          console.warn('⚠️  Force cleared ALL conversation IDs - this may affect other apps!')
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

      if (debug) {
        console.log(`📱 localStorage updated - cleared apps: [${clearedApps.join(', ')}]`)
        console.log('📡 Storage event dispatched for cross-tab synchronization')
      }
    }

    return cleared
  }
  catch (error) {
    console.error('Failed to clear conversation IDs from localStorage:', error)
    return false
  }
}

/**
 * Clear conversation IDs with app ID mapping resolution
 * Handles the case where logs use app.id but explore pages use installedApp.id
 * @param logAppId - App ID used in logs (typically app.id)
 * @param exploreAppId - App ID used in explore pages (typically installedApp.id)
 * @param options - Additional options
 */
export function clearConversationIdsWithMapping(
  logAppId: string,
  exploreAppId?: string,
  options: {
    /** Enable debug logging */
    debug?: boolean
  } = {},
): boolean {
  const { debug = true } = options

  if (debug)
    console.log(`🔧 Clearing conversation IDs for app mapping: logs(${logAppId}) <-> explore(${exploreAppId || 'same'})`)

  return clearConversationIds(logAppId, {
    clearRelated: exploreAppId && exploreAppId !== logAppId ? [exploreAppId] : [],
    debug,
  })
}

/**
 * Smart clear function that handles common app ID patterns
 * Attempts to clear both potential app IDs that might be related
 * @param appId - Primary app ID to clear
 * @param options - Additional options
 */
export function smartClearConversationIds(
  appId: string,
  options: {
    /** Enable debug logging */
    debug?: boolean
    /** Additional app IDs that might be related */
    potentialRelatedIds?: string[]
  } = {},
): boolean {
  const { debug = true, potentialRelatedIds = [] } = options

  if (typeof window === 'undefined')
    return false

  try {
    const conversationIdInfo: ConversationIdInfo = JSON.parse(
      localStorage.getItem(CONVERSATION_ID_INFO) || '{}',
    )

    // Find all keys that might be related to this app
    const allKeys = Object.keys(conversationIdInfo)
    const relatedIds: string[] = []

    // Add explicitly provided related IDs
    potentialRelatedIds.forEach((id) => {
      if (allKeys.includes(id) && id !== appId)
        relatedIds.push(id)
    })

    if (debug && relatedIds.length > 0)
      console.log(`🔍 Found potentially related app IDs: [${relatedIds.join(', ')}]`)

    return clearConversationIds(appId, {
      clearRelated: relatedIds,
      debug,
    })
  }
  catch (error) {
    console.error('Failed to smart clear conversation IDs:', error)
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