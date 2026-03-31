import type { ConversationListItem, ConversationLogs, ConversationSelection } from './list-utils'
import type { App } from '@/types/app'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useStore as useAppStore } from '@/app/components/app/store'
import useBreakpoints, { MediaType } from '@/hooks/use-breakpoints'
import { usePathname, useRouter, useSearchParams } from '@/next/navigation'
import { AppModeEnum } from '@/types/app'
import { buildConversationUrl, resolveConversationSelection } from './list-utils'

type AppStoreState = ReturnType<typeof useAppStore.getState>

type UseConversationDrawerParams = {
  appDetail: App
  logs?: ConversationLogs
  onRefresh: () => void
}

export const useConversationDrawer = ({ appDetail, logs, onRefresh }: UseConversationDrawerParams) => {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const conversationIdInUrl = searchParams.get('conversation_id') ?? undefined

  const media = useBreakpoints()
  const isMobile = media === MediaType.mobile

  const [closingConversationId, setClosingConversationId] = useState<string | null>(null)
  const [pendingConversationId, setPendingConversationId] = useState<string>()
  const pendingConversationCacheRef = useRef<ConversationSelection | undefined>(undefined)

  const isChatMode = appDetail.mode !== AppModeEnum.COMPLETION
  const isChatflow = appDetail.mode === AppModeEnum.ADVANCED_CHAT

  const {
    setShowAgentLogModal,
    setShowMessageLogModal,
    setShowPromptLogModal,
  } = useAppStore(useShallow((state: AppStoreState) => ({
    setShowPromptLogModal: state.setShowPromptLogModal,
    setShowAgentLogModal: state.setShowAgentLogModal,
    setShowMessageLogModal: state.setShowMessageLogModal,
  })))

  const activeConversationId = conversationIdInUrl ?? pendingConversationId
  const showDrawer = !!activeConversationId && closingConversationId !== activeConversationId
  const currentConversation = useMemo(() => {
    if (!showDrawer || !activeConversationId)
      return undefined

    if (conversationIdInUrl)
      return resolveConversationSelection(logs, conversationIdInUrl, pendingConversationCacheRef.current)

    return pendingConversationCacheRef.current
  }, [activeConversationId, conversationIdInUrl, logs, showDrawer])

  const handleRowClick = useCallback((log: ConversationListItem) => {
    if (conversationIdInUrl === log.id) {
      setClosingConversationId(null)

      return
    }

    setPendingConversationId(log.id)
    pendingConversationCacheRef.current = log
    setClosingConversationId(null)

    router.push(buildConversationUrl(pathname, searchParams, log.id), { scroll: false })
  }, [conversationIdInUrl, pathname, router, searchParams])

  useEffect(() => {
    if (!conversationIdInUrl) {
      if (!pendingConversationId) {
        queueMicrotask(() => {
          setClosingConversationId(null)
        })
        pendingConversationCacheRef.current = undefined
      }
      return
    }

    if (pendingConversationId === conversationIdInUrl) {
      queueMicrotask(() => {
        setPendingConversationId(undefined)
      })
    }

    const nextConversation = resolveConversationSelection(logs, conversationIdInUrl, pendingConversationCacheRef.current)
    if (pendingConversationCacheRef.current?.id === conversationIdInUrl || ('created_at' in nextConversation))
      pendingConversationCacheRef.current = undefined
  }, [conversationIdInUrl, logs, pendingConversationId])

  const onCloseDrawer = useCallback(() => {
    onRefresh()
    setClosingConversationId(activeConversationId ?? null)
    setShowPromptLogModal(false)
    setShowAgentLogModal(false)
    setShowMessageLogModal(false)
    setPendingConversationId(undefined)
    pendingConversationCacheRef.current = undefined

    if (conversationIdInUrl)
      router.replace(buildConversationUrl(pathname, searchParams), { scroll: false })
  }, [activeConversationId, conversationIdInUrl, onRefresh, pathname, router, searchParams, setShowAgentLogModal, setShowMessageLogModal, setShowPromptLogModal])

  return {
    activeConversationId,
    currentConversation,
    handleRowClick,
    isChatMode,
    isChatflow,
    isMobile,
    onCloseDrawer,
    showDrawer,
  }
}
