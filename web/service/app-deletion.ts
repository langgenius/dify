type AppDeletionState = {
  pendingCount: number
  deleted: boolean
}

// Successful IDs stay as session tombstones for requests that settle after navigation.
const appDeletionStates = new Map<string, AppDeletionState>()

export const markAppDeletionStarted = (appId: string) => {
  const state = appDeletionStates.get(appId)
  appDeletionStates.set(appId, {
    pendingCount: (state?.pendingCount ?? 0) + 1,
    deleted: state?.deleted ?? false,
  })
}

export const markAppDeletionSucceeded = (appId: string) => {
  const state = appDeletionStates.get(appId)
  appDeletionStates.set(appId, {
    pendingCount: Math.max((state?.pendingCount ?? 1) - 1, 0),
    deleted: true,
  })
}

export const markAppDeletionFailed = (appId: string) => {
  const state = appDeletionStates.get(appId)
  if (!state) return

  const pendingCount = Math.max(state.pendingCount - 1, 0)
  if (!pendingCount && !state.deleted) {
    appDeletionStates.delete(appId)
    return
  }

  appDeletionStates.set(appId, { ...state, pendingCount })
}

export const isAppDeletingOrDeleted = (appId: string) => appDeletionStates.has(appId)
