import { useRouter } from '@/next/navigation'

function openedFromSameOrigin() {
  try {
    return window.opener?.location.origin === window.location.origin
  } catch {
    return false
  }
}

export function useExitDemo() {
  const router = useRouter()
  return () => {
    if (openedFromSameOrigin()) {
      window.close()
      if (window.closed) return
    }
    router.replace('/apps')
  }
}
