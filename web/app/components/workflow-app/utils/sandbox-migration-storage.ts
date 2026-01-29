const SANDBOX_MIGRATION_DISMISSED_KEY = 'workflow:sandbox-migration-dismissed-app-ids'

export const getSandboxMigrationDismissed = (appId?: string) => {
  if (!appId || typeof window === 'undefined')
    return false
  try {
    const raw = window.localStorage.getItem(SANDBOX_MIGRATION_DISMISSED_KEY)
    if (!raw)
      return false
    const parsed = JSON.parse(raw) as unknown
    return Array.isArray(parsed) && parsed.includes(appId)
  }
  catch {
    return false
  }
}

export const setSandboxMigrationDismissed = (appId?: string) => {
  if (!appId || typeof window === 'undefined')
    return
  try {
    const raw = window.localStorage.getItem(SANDBOX_MIGRATION_DISMISSED_KEY)
    const parsed = raw ? JSON.parse(raw) as unknown : []
    const ids = new Set<string>(Array.isArray(parsed) ? (parsed as string[]) : [])
    ids.add(appId)
    window.localStorage.setItem(SANDBOX_MIGRATION_DISMISSED_KEY, JSON.stringify(Array.from(ids)))
  }
  catch {
    window.localStorage.setItem(SANDBOX_MIGRATION_DISMISSED_KEY, JSON.stringify([appId]))
  }
}
