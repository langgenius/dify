'use client'

import type { ChatConfig } from '@/app/components/base/chat/types'
import Loading from '@/app/components/base/loading'
import { AccessMode } from '@/models/access-control'
import type { AppData, AppMeta } from '@/models/share'
import { useGetWebAppAccessModeByCode } from '@/service/use-share'
import { usePathname, useSearchParams } from 'next/navigation'
import type { FC, PropsWithChildren } from 'react'
import { useEffect } from 'react'
import { create } from 'zustand'
import { getProcessedSystemVariablesFromUrlParams } from '@/app/components/base/chat/utils'
import { useGlobalPublicStore } from './global-public-context'

type WebAppStore = {
  shareCode: string | null
  updateShareCode: (shareCode: string | null) => void
  appInfo: AppData | null
  updateAppInfo: (appInfo: AppData | null) => void
  appParams: ChatConfig | null
  updateAppParams: (appParams: ChatConfig | null) => void
  webAppAccessMode: AccessMode
  updateWebAppAccessMode: (accessMode: AccessMode) => void
  appMeta: AppMeta | null
  updateWebAppMeta: (appMeta: AppMeta | null) => void
  userCanAccessApp: boolean
  updateUserCanAccessApp: (canAccess: boolean) => void
  embeddedUserId: string | null
  updateEmbeddedUserId: (userId: string | null) => void
  embeddedConversationId: string | null
  updateEmbeddedConversationId: (conversationId: string | null) => void
}

export const useWebAppStore = create<WebAppStore>(set => ({
  shareCode: null,
  updateShareCode: (shareCode: string | null) => set(() => ({ shareCode })),
  appInfo: null,
  updateAppInfo: (appInfo: AppData | null) => set(() => ({ appInfo })),
  appParams: null,
  updateAppParams: (appParams: ChatConfig | null) => set(() => ({ appParams })),
  webAppAccessMode: AccessMode.SPECIFIC_GROUPS_MEMBERS,
  updateWebAppAccessMode: (accessMode: AccessMode) => set(() => ({ webAppAccessMode: accessMode })),
  appMeta: null,
  updateWebAppMeta: (appMeta: AppMeta | null) => set(() => ({ appMeta })),
  userCanAccessApp: false,
  updateUserCanAccessApp: (canAccess: boolean) => set(() => ({ userCanAccessApp: canAccess })),
  embeddedUserId: null,
  updateEmbeddedUserId: (userId: string | null) => set(() => ({ embeddedUserId: userId })),
  embeddedConversationId: null,
  updateEmbeddedConversationId: (conversationId: string | null) =>
    set(() => ({ embeddedConversationId: conversationId })),
}))

const getShareCodeFromRedirectUrl = (redirectUrl: string | null): string | null => {
  if (!redirectUrl || redirectUrl.length === 0)
    return null
  const url = new URL(`${window.location.origin}${decodeURIComponent(redirectUrl)}`)
  return url.pathname.split('/').pop() || null
}
const getShareCodeFromPathname = (pathname: string): string | null => {
  const code = pathname.split('/').pop() || null
  if (code === 'webapp-signin')
    return null
  return code
}

const WebAppStoreProvider: FC<PropsWithChildren> = ({ children }) => {
  const isGlobalPending = useGlobalPublicStore(s => s.isGlobalPending)
  const updateWebAppAccessMode = useWebAppStore(state => state.updateWebAppAccessMode)
  const updateShareCode = useWebAppStore(state => state.updateShareCode)
  const updateEmbeddedUserId = useWebAppStore(state => state.updateEmbeddedUserId)
  const updateEmbeddedConversationId = useWebAppStore(state => state.updateEmbeddedConversationId)
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const redirectUrlParam = searchParams.get('redirect_url')
  const searchParamsString = searchParams.toString()

  // Compute shareCode directly
  const shareCode = getShareCodeFromRedirectUrl(redirectUrlParam) || getShareCodeFromPathname(pathname)
  useEffect(() => {
    updateShareCode(shareCode)
  }, [shareCode, updateShareCode])

  useEffect(() => {
    let cancelled = false
    const syncEmbeddedUserId = async () => {
      try {
        const { user_id, conversation_id } = await getProcessedSystemVariablesFromUrlParams()
        if (!cancelled) {
          updateEmbeddedUserId(user_id || null)
          updateEmbeddedConversationId(conversation_id || null)
        }
      }
      catch {
        if (!cancelled) {
          updateEmbeddedUserId(null)
          updateEmbeddedConversationId(null)
        }
      }
    }
    syncEmbeddedUserId()
    return () => {
      cancelled = true
    }
  }, [searchParamsString, updateEmbeddedUserId, updateEmbeddedConversationId])

  const { isLoading, data: accessModeResult } = useGetWebAppAccessModeByCode(shareCode)

  useEffect(() => {
    if (accessModeResult?.accessMode)
      updateWebAppAccessMode(accessModeResult.accessMode)
  }, [accessModeResult, updateWebAppAccessMode, shareCode])

  if (isGlobalPending || isLoading) {
    return <div className='flex h-full w-full items-center justify-center'>
      <Loading />
    </div>
  }
  return (
    <>
      {children}
    </>
  )
}
export default WebAppStoreProvider
