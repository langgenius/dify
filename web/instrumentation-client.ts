import { IS_DEV } from '@/config'
import { env } from '@/env'

async function main() {
  if (!('localStorage' in globalThis) || !('sessionStorage' in globalThis)) {
    class StorageMock {
      data: Record<string, string>

      constructor() {
        this.data = {} as Record<string, string>
      }

      setItem(name: string, value: string) {
        this.data[name] = value
      }

      getItem(name: string) {
        return this.data[name] || null
      }

      removeItem(name: string) {
        delete this.data[name]
      }

      clear() {
        this.data = {}
      }
    }

    let localStorage, sessionStorage

    try {
      localStorage = globalThis.localStorage
      sessionStorage = globalThis.sessionStorage
    }
    catch {
      localStorage = new StorageMock()
      sessionStorage = new StorageMock()
    }

    Object.defineProperty(globalThis, 'localStorage', {
      value: localStorage,
    })

    Object.defineProperty(globalThis, 'sessionStorage', {
      value: sessionStorage,
    })
  }

  const SENTRY_DSN = env.NEXT_PUBLIC_SENTRY_DSN

  if (!IS_DEV && SENTRY_DSN) {
    const Sentry = await import('@sentry/react')
    Sentry.init({
      dsn: SENTRY_DSN,
      integrations: [
        Sentry.browserTracingIntegration(),
        Sentry.replayIntegration(),
      ],
      tracesSampleRate: 0.1,
      replaysSessionSampleRate: 0.1,
      replaysOnErrorSampleRate: 1.0,
    })
  }
}

main()
