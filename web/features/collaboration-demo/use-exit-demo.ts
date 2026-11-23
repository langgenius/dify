import { useQueryState } from 'nuqs'
import { useRouter } from '@/next/navigation'
import { demoSourceQueryParamName, demoSourceQueryParser } from './query-params'

function openedFromSameOrigin() {
  try {
    return window.opener?.location.origin === window.location.origin
  } catch {
    return false
  }
}

export function useExitDemo() {
  const router = useRouter()
  const [source] = useQueryState(demoSourceQueryParamName, demoSourceQueryParser)
  return () => {
    if (openedFromSameOrigin() || source === 'notification') {
      window.close()
      if (window.closed) return
    }
    router.replace('/apps')
  }
}
