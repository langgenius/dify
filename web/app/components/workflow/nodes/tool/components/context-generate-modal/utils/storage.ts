// Storage key prefix used by useContextGenData
import { STORAGE_KEYS } from '@/config/storage-keys'

export const CONTEXT_GEN_STORAGE_SUFFIX = {
  versions: 'versions',
  versionIndex: 'version-index',
  messages: 'messages',
  suggestedQuestions: 'suggested-questions',
  suggestedQuestionsFetched: 'suggested-questions-fetched',
} as const

export type ContextGenStorageSuffix = typeof CONTEXT_GEN_STORAGE_SUFFIX[keyof typeof CONTEXT_GEN_STORAGE_SUFFIX]

/**
 * Build storage key from flowId, toolNodeId, and paramKey.
 */
export const buildContextGenStorageKey = (
  flowId: string | undefined,
  toolNodeId: string,
  paramKey: string,
): string => {
  const segments = [flowId || 'unknown', toolNodeId, paramKey].filter(Boolean)
  return segments.join('-')
}

const buildContextGenStorageKeyWithPrefix = (storageKey: string, suffix: ContextGenStorageSuffix): string => {
  return `${STORAGE_KEYS.SESSION.CONTEXT_GENERATE.PREFIX}${storageKey}-${suffix}`
}

export const getContextGenStorageKey = (storageKey: string, suffix: ContextGenStorageSuffix): string => {
  return buildContextGenStorageKeyWithPrefix(storageKey, suffix)
}

export const getContextGenStorageKeys = (storageKey: string): string[] => {
  return [
    getContextGenStorageKey(storageKey, CONTEXT_GEN_STORAGE_SUFFIX.versions),
    getContextGenStorageKey(storageKey, CONTEXT_GEN_STORAGE_SUFFIX.versionIndex),
    getContextGenStorageKey(storageKey, CONTEXT_GEN_STORAGE_SUFFIX.messages),
    getContextGenStorageKey(storageKey, CONTEXT_GEN_STORAGE_SUFFIX.suggestedQuestions),
    getContextGenStorageKey(storageKey, CONTEXT_GEN_STORAGE_SUFFIX.suggestedQuestionsFetched),
  ]
}

export const clearContextGenStorage = (storageKey: string): void => {
  const keys = getContextGenStorageKeys(storageKey)
  keys.forEach((key) => {
    try {
      sessionStorage.removeItem(key)
    }
    catch {
      // Ignore errors (e.g., SSR or private browsing)
    }
  })
}
