import { useRouter } from '@/next/navigation'

function openedFromSameOrigin() {
  try {
    return window.opener?.location.origin === window.location.origin
  } catch {
    return false
  }
}

function openedFromNotification() {
  return new URLSearchParams(window.location.search).get('from') === 'notification'
}

export function useExitDemo() {
  const router = useRouter()
  return () => {
    if (openedFromSameOrigin() || openedFromNotification()) {
      window.close()
      if (window.closed) return
    }
    router.replace('/apps')
  }
}
