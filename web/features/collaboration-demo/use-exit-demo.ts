import { useQueryStates } from 'nuqs'
import { flushEvents } from '@/app/components/base/amplitude/utils'
import { useRouter } from '@/next/navigation'
import { demoSearchParams } from './query-params'

function openedFromSameOrigin() {
  try {
    return window.opener?.location.origin === window.location.origin
  } catch {
    return false
  }
}

function sendQueuedEvents() {
  return Promise.race([
    flushEvents()?.promise,
    new Promise((resolve) => window.setTimeout(resolve, 500)),
  ]).catch(() => {})
}

export function useExitDemo() {
  const router = useRouter()
  const [{ source }] = useQueryStates(demoSearchParams)
  return () => {
    if (!openedFromSameOrigin() && source !== 'notification') {
      router.replace('/apps')
      return
    }
    void sendQueuedEvents().then(() => {
      window.close()
      if (!window.closed) router.replace('/apps')
    })
  }
}
