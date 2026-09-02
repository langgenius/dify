const SESSION_STORAGE_PREFIX = 'dify-builder:v1:'

export const getSessionStorageKey = (tenantId?: string, userId?: string, appId?: string) => {
  if (!tenantId || !userId || !appId) return null
  return `${SESSION_STORAGE_PREFIX}${encodeURIComponent(tenantId)}:${encodeURIComponent(userId)}:${encodeURIComponent(appId)}:active-session-id`
}
