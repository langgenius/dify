import { useQueryStates } from 'nuqs'
import { useRouter } from '@/next/navigation'
import { demoSearchParams } from './query-params'

function openedFromSameOrigin() {
  try {
    return window.opener?.location.origin === window.location.origin
  } catch {
    return false
  }
}

export function useExitDemo() {
  const router = useRouter()
  const [{ source }] = useQueryStates(demoSearchParams)
  return () => {
    if (openedFromSameOrigin() || source === 'notification') {
      window.close()
      if (window.closed) return
    }
    router.replace('/apps')
  }
}
