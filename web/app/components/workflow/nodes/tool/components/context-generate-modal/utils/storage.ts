// Storage key prefix used by useContextGenData
const CONTEXT_GEN_PREFIX = 'context-gen-'

/**
 * Build storage key from flowId, toolNodeId, and paramKey.
 * Mirrors the logic in context-generate-modal/index.tsx.
 */
export const buildContextGenStorageKey = (
  flowId: string | undefined,
  toolNodeId: string,
  paramKey: string,
): string => {
  const segments = [flowId || 'unknown', toolNodeId, paramKey].filter(Boolean)
  return segments.join('-')
}

export const getContextGenStorageKeys = (storageKey: string): string[] => {
  return [
    `${CONTEXT_GEN_PREFIX}${storageKey}-versions`,
    `${CONTEXT_GEN_PREFIX}${storageKey}-version-index`,
    `${storageKey}-messages`,
    `${storageKey}-suggested-questions`,
    `${storageKey}-suggested-questions-fetched`,
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
