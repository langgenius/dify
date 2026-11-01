import type { DifyBuilderLifecycleControl } from '../session/state'

const SESSION_STORAGE_PREFIX = 'dify-builder:v1:'

export const getSessionStorageKey = (tenantId?: string, userId?: string, appId?: string) => {
  if (!tenantId || !userId || !appId) return null
  return `${SESSION_STORAGE_PREFIX}${encodeURIComponent(tenantId)}:${encodeURIComponent(userId)}:${encodeURIComponent(appId)}:active-session-id`
}

export const getLifecycleStorageKey = (sessionStorageKey: string) => `${sessionStorageKey}:control`

export const parseStoredLifecycleControl = (
  value: string | null,
): DifyBuilderLifecycleControl | null => {
  if (!value) return null
  try {
    const parsed: unknown = JSON.parse(value)
    if (!parsed || typeof parsed !== 'object') return null
    const operations = ['clear', 'abandon', 'fix', 'dismiss_fix', 'stop_and_switch_fix'] as const
    const operation = operations.find(
      (candidate) => 'operation' in parsed && candidate === parsed.operation,
    )
    if (
      !operation ||
      !('sessionId' in parsed) ||
      typeof parsed.sessionId !== 'string' ||
      !('clientActionId' in parsed) ||
      typeof parsed.clientActionId !== 'string' ||
      !('baseVersion' in parsed) ||
      typeof parsed.baseVersion !== 'number' ||
      parsed.baseVersion < 1
    )
      return null
    return {
      operation,
      phase: 'unknown',
      sessionId: parsed.sessionId,
      clientActionId: parsed.clientActionId,
      baseVersion: parsed.baseVersion,
      ...('expectedTaskId' in parsed && typeof parsed.expectedTaskId === 'string'
        ? { expectedTaskId: parsed.expectedTaskId }
        : {}),
    }
  } catch {
    return null
  }
}
