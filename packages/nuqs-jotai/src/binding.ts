import type { SetValues, UseQueryStatesKeysMap } from 'nuqs'

type QueryWriter = SetValues<UseQueryStatesKeysMap>
export type Binding = {
  write: QueryWriter
  refresh: (write: QueryWriter) => void
  connect: (write: QueryWriter) => () => void
  dispose: () => void
}

/** No URL scheduler: only hold mount-time commands until nuqs has subscribed. */
export function createBinding(): Binding {
  let writer: QueryWriter | undefined
  let disposed = false
  const waiting: {
    args: Parameters<QueryWriter>
    resolve: (value: URLSearchParams | PromiseLike<URLSearchParams>) => void
    reject: (error: unknown) => void
  }[] = []
  const unavailable = () => new Error('[nuqs-jotai] Cannot write after QueryStateProvider unmounts')
  return {
    write(...args) {
      if (disposed) throw unavailable()
      if (writer && waiting.length === 0) return writer(...args)
      return new Promise((resolve, reject) => waiting.push({ args, resolve, reject }))
    },
    refresh(write) {
      // Only refresh an attached connection. Mount/reveal commands must still
      // wait until nuqs reattaches its passive subscriptions.
      if (writer) writer = write
    },
    connect(write) {
      writer = write
      let active = true
      // Parent and sibling nuqs hooks may not have subscribed yet. Flush held
      // commands after this effect pass, preserving their typed emitter payloads.
      queueMicrotask(() => {
        if (!active || disposed) return
        for (const request of waiting.splice(0)) {
          try {
            request.resolve(write(...request.args))
          } catch (error) {
            request.reject(error)
          }
        }
      })
      return () => {
        active = false
        writer = undefined
      }
    },
    dispose() {
      disposed = true
      writer = undefined
      for (const request of waiting.splice(0)) request.reject(unavailable())
    },
  }
}
