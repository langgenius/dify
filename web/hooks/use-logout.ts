'use client'
import { useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { useModalContext } from '@/context/modal-context'
import { logout } from '@/service/common'

export type LogoutOptions = {
  source?: 'header' | 'account' | 'share-app' | 'education' | 'delete-account' | 'email-change' | 'chat-sidebar'
  skipConfirm?: boolean
  onSuccess?: () => void
  redirectUrl?: string
  isWebApp?: boolean
}

const useLogout = () => {
  const router = useRouter()
  const { setShowLogoutModal } = useModalContext()

  const performLogout = useCallback(async (options: LogoutOptions = {}) => {
    try {
      await logout({
        url: '/logout',
        params: {},
      })

      const itemsToRemove = [
        'setup_status',
        'console_token',
        'refresh_token',
      ]

      if (options.isWebApp) {
        itemsToRemove.push('token')
        itemsToRemove.push('webapp_access_token')
      }

      // Always remove education-related items to avoid using other account's education notice info
      itemsToRemove.push('education-reverify-prev-expire-at')
      itemsToRemove.push('education-reverify-has-noticed')
      itemsToRemove.push('education-expired-has-noticed')

      itemsToRemove.forEach(item => localStorage.removeItem(item))

      const redirectTo = options.redirectUrl || (options.isWebApp ? '/webapp-signin' : '/signin')
      router.push(redirectTo)

      options.onSuccess?.()
    }
    catch (error) {
      console.error('Logout failed:', error)
    }
  }, [router])

  const handleLogout = useCallback((options: LogoutOptions = {}) => {
    if (options.skipConfirm) {
      return performLogout(options)
    }
    else {
      setShowLogoutModal({
        source: options.source,
        isWebApp: options.isWebApp,
        onConfirm: () => {
          performLogout(options)
        },
      })
    }
  }, [performLogout, setShowLogoutModal])

  return { handleLogout }
}

export default useLogout
