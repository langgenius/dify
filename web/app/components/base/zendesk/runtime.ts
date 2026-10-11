import type { DeploymentEdition } from '@dify/contracts/api/console/system-features/types.gen'

export type ZendeskConversationField = {
  id: string
  value: unknown
}

type ZendeskApi = (
  command: string,
  value: string,
  payload?: ZendeskConversationField[] | string | string[] | (() => unknown),
  callback?: () => unknown,
) => void

declare global {
  // oxlint-disable-next-line typescript/consistent-type-definitions
  interface Window {
    zE?: ZendeskApi
  }
}

type ZendeskRuntimeStatus = 'idle' | 'loading' | 'ready' | 'error'

export type ZendeskRuntimeSnapshot = {
  attempt: number
  status: ZendeskRuntimeStatus
}

type LoadDeferred = {
  promise: Promise<void>
  reject: (error: Error) => void
  resolve: () => void
}

const idleSnapshot: ZendeskRuntimeSnapshot = { attempt: 0, status: 'idle' }

export function createZendeskRuntime(getApi: () => ZendeskApi | undefined) {
  let snapshot = idleSnapshot
  let loadDeferred: LoadDeferred | undefined
  let openPromise: Promise<void> | undefined
  const listeners = new Set<() => void>()
  const pendingFields = new Map<string, ZendeskConversationField>()
  const pendingFieldsCallbacks: Array<() => unknown> = []

  const publish = (nextSnapshot: ZendeskRuntimeSnapshot) => {
    snapshot = nextSnapshot
    listeners.forEach((listener) => listener())
  }

  const requestLoad = () => {
    if (snapshot.status === 'ready') return Promise.resolve()
    if (snapshot.status === 'loading' && loadDeferred) return loadDeferred.promise

    let resolve!: () => void
    let reject!: (error: Error) => void
    const promise = new Promise<void>((resolvePromise, rejectPromise) => {
      resolve = resolvePromise
      reject = rejectPromise
    })
    loadDeferred = { promise, reject, resolve }
    publish({ attempt: snapshot.attempt + 1, status: 'loading' })
    return promise
  }

  const rejectLoad = (error: Error) => {
    if (snapshot.status !== 'loading') return

    const deferred = loadDeferred
    loadDeferred = undefined
    publish({ ...snapshot, status: 'error' })
    deferred?.reject(error)
  }

  const markReady = () => {
    if (snapshot.status !== 'loading') return

    const api = getApi()
    if (!api) {
      rejectLoad(new Error('Zendesk loaded without exposing its client API'))
      return
    }

    const deferred = loadDeferred
    loadDeferred = undefined
    publish({ ...snapshot, status: 'ready' })

    const fields = Array.from(pendingFields.values())
    const callbacks = pendingFieldsCallbacks.splice(0)
    pendingFields.clear()
    if (fields.length > 0) {
      api(
        'messenger:set',
        'conversationFields',
        fields,
        callbacks.length > 0 ? () => callbacks.forEach((callback) => callback()) : undefined,
      )
    }
    deferred?.resolve()
  }

  const setConversationFields = (
    fields: ZendeskConversationField[],
    deploymentEdition: DeploymentEdition,
    callback?: () => unknown,
  ) => {
    if (deploymentEdition !== 'CLOUD') return

    if (snapshot.status === 'ready') {
      getApi()?.('messenger:set', 'conversationFields', fields, callback)
      return
    }

    fields.forEach((field) => pendingFields.set(field.id, field))
    if (callback) pendingFieldsCallbacks.push(callback)
  }

  const open = (deploymentEdition: DeploymentEdition) => {
    if (deploymentEdition !== 'CLOUD') return Promise.resolve()
    if (openPromise) return openPromise

    openPromise = requestLoad()
      .then(() => {
        const api = getApi()
        if (!api) throw new Error('Zendesk client API is unavailable')

        api('messenger', 'show')
        api('messenger', 'open')
      })
      .finally(() => {
        openPromise = undefined
      })
    return openPromise
  }

  return {
    getServerSnapshot: () => idleSnapshot,
    getSnapshot: () => snapshot,
    markFailed: () => rejectLoad(new Error('Failed to load Zendesk')),
    markReady,
    open,
    requestLoad,
    setConversationFields,
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}

export type ZendeskRuntime = ReturnType<typeof createZendeskRuntime>

export const zendeskRuntime = createZendeskRuntime(() => window.zE)
