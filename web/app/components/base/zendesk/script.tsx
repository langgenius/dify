'use client'

import type { ZendeskRuntime } from './runtime'
import { useEffect, useSyncExternalStore } from 'react'
import { zendeskRuntime } from './runtime'

const ZENDESK_SCRIPT_LOAD_TIMEOUT = 15_000
const activeLoaders = new WeakMap<ZendeskRuntime, number>()

function retainLoader(runtime: ZendeskRuntime) {
  activeLoaders.set(runtime, (activeLoaders.get(runtime) ?? 0) + 1)
}

function releaseLoader(runtime: ZendeskRuntime) {
  const nextCount = (activeLoaders.get(runtime) ?? 1) - 1
  if (nextCount > 0) activeLoaders.set(runtime, nextCount)
  else activeLoaders.delete(runtime)
}

type ZendeskScriptProps = {
  nonce?: string
  runtime?: ZendeskRuntime
  widgetKey: string
}

export function ZendeskScript({ nonce, runtime = zendeskRuntime, widgetKey }: ZendeskScriptProps) {
  const { attempt, status } = useSyncExternalStore(
    runtime.subscribe,
    runtime.getSnapshot,
    runtime.getServerSnapshot,
  )

  useEffect(() => {
    if (status !== 'loading') return

    retainLoader(runtime)
    const existingScript = document.getElementById('ze-snippet')
    if (existingScript) existingScript.remove()

    const script = document.createElement('script')
    script.id = 'ze-snippet'
    script.src = `https://static.zdassets.com/ekr/snippet.js?key=${widgetKey}`
    script.async = true
    if (nonce) script.nonce = nonce

    let timeoutId: number
    const handleLoad = () => {
      window.clearTimeout(timeoutId)
      runtime.markReady()
    }
    const handleError = () => {
      window.clearTimeout(timeoutId)
      script.remove()
      runtime.markFailed()
    }
    script.addEventListener('load', handleLoad)
    script.addEventListener('error', handleError)
    document.body.appendChild(script)
    timeoutId = window.setTimeout(handleError, ZENDESK_SCRIPT_LOAD_TIMEOUT)

    return () => {
      window.clearTimeout(timeoutId)
      script.removeEventListener('load', handleLoad)
      script.removeEventListener('error', handleError)
      releaseLoader(runtime)
      queueMicrotask(() => {
        const currentSnapshot = runtime.getSnapshot()
        if (
          activeLoaders.has(runtime) ||
          currentSnapshot.status !== 'loading' ||
          currentSnapshot.attempt !== attempt
        )
          return

        script.remove()
        runtime.markFailed()
      })
    }
  }, [attempt, nonce, runtime, status, widgetKey])

  return null
}
