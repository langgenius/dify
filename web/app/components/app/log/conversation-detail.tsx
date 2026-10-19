'use client'

import type {
  AppDetailWithSite,
  ConversationDetail as ChatConversationDetail,
  ConversationMessageDetail,
  GetAppsByAppIdChatMessagesData,
} from '@dify/contracts/api/console/apps/types.gen'
import type { FeedbackFunc, IChatItem } from '@/app/components/base/chat/chat/type'
import type { ChatConfig } from '@/app/components/base/chat/types'
import { Button } from '@langgenius/dify-ui/button'
import { DialogTitle } from '@langgenius/dify-ui/dialog'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@langgenius/dify-ui/tooltip'
import {
  QueryErrorResetBoundary,
  skipToken,
  useQuery,
  useSuspenseQueries,
  useSuspenseQuery,
} from '@tanstack/react-query'
import { noop } from 'es-toolkit/function'
import { Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import TextGeneration from '@/app/components/app/text-generate/item'
import AgentLogModal from '@/app/components/base/agent-log-modal'
import Chat from '@/app/components/base/chat/chat'
import CopyIcon from '@/app/components/base/copy-icon'
import ErrorBoundary from '@/app/components/base/error-boundary'
import MessageLogModal from '@/app/components/base/message-log-modal'
import PromptLogModal from '@/app/components/base/prompt-log-modal'
import { WorkflowContextProvider } from '@/app/components/workflow/context'
import { toast } from '@/app/notifications'
import { userProfileQueryOptions } from '@/features/account-profile/client'
import useTimestamp from '@/hooks/use-timestamp'
import { consoleClient, consoleQuery } from '@/service/console'
import { AppSourceType } from '@/service/share'
import {
  applyAnnotationAdded,
  applyAnnotationEdited,
  applyAnnotationRemoved,
  buildChatThreadState,
  getAdminFeedback,
  getCompletionMessageFiles,
  getDetailVarList,
  getFormattedChatList,
  getLogModelInfo,
  getStringInputs,
  getThreadChatItems,
  isNearTopLoadMore,
  mergeUniqueChatItems,
} from './list-utils'
import { ConversationSkeleton } from './loading'
import ModelInfo from './model-info'
import VarPanel from './var-panel'

type Messages = Awaited<ReturnType<typeof consoleClient.apps.byAppId.chatMessages.get>>

type IDetailPanel = {
  appDetail: AppDetailWithSite
  detail: ChatConversationDetail | ConversationMessageDetail
  onFeedback: FeedbackFunc
  initialMessages?: Messages
}

function DetailPanel({ appDetail, detail, onFeedback, initialMessages }: IDetailPanel) {
  const MIN_ITEMS_FOR_SCROLL_LOADING = 8
  const SCROLL_DEBOUNCE_MS = 200
  const { data: timezone } = useQuery({
    ...userProfileQueryOptions(),
    select: (data) => data.profile.timezone ?? undefined,
  })
  const [selectedLogItem, setSelectedLogItem] = useState<IChatItem>()
  const { t } = useTranslation(['appLog', 'common'])
  const [hasMore, setHasMore] = useState(initialMessages?.has_more ?? false)
  const [varValues, setVarValues] = useState(() =>
    getStringInputs(initialMessages?.data.at(-1)?.inputs ?? {}),
  )
  const lastLoadTimeRef = useRef(0)
  const [allChatItems, setAllChatItems] = useState(() =>
    getFormattedChatList(
      initialMessages?.data ?? [],
      detail.id,
      timezone!,
      t(($) => $.dateTimeFormat, { ns: 'appLog' }),
    ),
  )
  const [selectedMessageId, setSelectedMessageId] = useState<string>()
  const {
    chatItemTree,
    oldestAnswerId,
    threadChatItems: defaultThread,
  } = buildChatThreadState({
    allChatItems,
    hasMore,
    introduction: 'introduction' in detail ? (detail.introduction ?? undefined) : undefined,
  })
  const threadChatItems = selectedMessageId
    ? getThreadChatItems(chatItemTree, selectedMessageId)
    : defaultThread
  const switchSibling = setSelectedMessageId

  const handleAnnotationEdited = useCallback(
    (query: string, answer: string, index: number) => {
      setAllChatItems(applyAnnotationEdited(allChatItems, query, answer, index))
    },
    [allChatItems],
  )
  const handleAnnotationAdded = useCallback(
    (annotationId: string, authorName: string, query: string, answer: string, index: number) => {
      setAllChatItems(
        applyAnnotationAdded(allChatItems, annotationId, authorName, query, answer, index),
      )
    },
    [allChatItems],
  )
  const handleAnnotationRemoved = useCallback(
    async (index: number): Promise<boolean> => {
      const annotation = allChatItems[index]?.annotation

      try {
        if (annotation?.id) {
          await consoleClient.apps.byAppId.annotations.byAnnotationId.delete({
            params: { app_id: appDetail.id, annotation_id: annotation.id },
          })
        }

        setAllChatItems(applyAnnotationRemoved(allChatItems, index))

        toast.success(t(($) => $['actionMsg.modifiedSuccessfully'], { ns: 'common' }))
        return true
      } catch {
        toast.error(t(($) => $['actionMsg.modifiedUnsuccessfully'], { ns: 'common' }))
        return false
      }
    },
    [allChatItems, appDetail.id, t],
  )

  const [isLoading, setIsLoading] = useState(false)

  const loadMoreMessages = useCallback(async () => {
    if (isLoading || !hasMore || !appDetail.id || !detail.id) return

    // Throttle using ref to persist across re-renders
    const now = Date.now()
    if (now - lastLoadTimeRef.current < SCROLL_DEBOUNCE_MS) return
    lastLoadTimeRef.current = now

    setIsLoading(true)

    try {
      const params: GetAppsByAppIdChatMessagesData['query'] = {
        conversation_id: detail.id,
        limit: 10,
      }

      // Use ref for pagination anchor to avoid stale closure issues
      if (oldestAnswerId) {
        params.first_id = oldestAnswerId
      }

      const messageRes = await consoleClient.apps.byAppId.chatMessages.get({
        params: { app_id: appDetail.id },
        query: params,
      })

      if (!messageRes.data || messageRes.data.length === 0) {
        setHasMore(false)
        return
      }

      if (messageRes.data.length > 0) {
        const varValues = getStringInputs(messageRes.data.at(-1)!.inputs)
        setVarValues(varValues)
      }

      setHasMore(messageRes.has_more)

      const newItems = getFormattedChatList(
        messageRes.data,
        detail.id,
        timezone!,
        t(($) => $.dateTimeFormat, { ns: 'appLog' }) as string,
      )

      setAllChatItems((items) => mergeUniqueChatItems(items, newItems))
    } catch (error) {
      console.error(error)
      setHasMore(false)
    } finally {
      setIsLoading(false)
    }
  }, [detail.id, hasMore, isLoading, timezone, t, appDetail, oldestAnswerId])

  const handleScroll = useCallback(() => {
    const scrollableDiv = document.getElementById('scrollableDiv')
    if (!scrollableDiv) return
    const clientHeight = scrollableDiv.clientHeight
    const scrollHeight = scrollableDiv.scrollHeight
    const currentScrollTop = scrollableDiv.scrollTop
    // currentScrollTop is negative due to column-reverse flex direction
    const isNearTop = isNearTopLoadMore({
      clientHeight,
      scrollHeight,
      scrollTop: currentScrollTop,
    })

    if (isNearTop && hasMore && !isLoading) {
      loadMoreMessages()
    }
  }, [hasMore, isLoading, loadMoreMessages])

  const isChatMode = appDetail.mode !== 'completion'
  const isAdvanced = appDetail.mode === 'advanced-chat'
  const logKind = selectedLogItem?.workflow_run_id
    ? 'workflow'
    : selectedLogItem?.agent_thoughts?.length
      ? 'agent'
      : selectedLogItem?.log
        ? 'prompt'
        : undefined

  const varList = getDetailVarList(detail, varValues)
  const message_files = getCompletionMessageFiles(detail, isChatMode)
  const completionMessage = 'message' in detail ? detail.message : undefined

  const [width, setWidth] = useState(0)
  const ref = useRef<HTMLDivElement>(null)

  const adjustModalWidth = () => {
    if (ref.current) setWidth(document.body.clientWidth - (ref.current?.clientWidth + 16) - 8)
  }

  useEffect(() => {
    const raf = requestAnimationFrame(adjustModalWidth)
    return () => cancelAnimationFrame(raf)
  }, [])

  return (
    <div ref={ref} className="flex min-h-0 flex-1 flex-col">
      {/* Panel Body */}
      <div className="shrink-0 px-1 pt-1">
        <div className="rounded-t-xl bg-background-section-burn p-3 pb-2">
          {(varList.length > 0 || (!isChatMode && message_files.length > 0)) && (
            <VarPanel varList={varList} message_files={message_files} />
          )}
        </div>
      </div>
      <div className="mx-1 mb-1 grow overflow-auto rounded-b-xl bg-background-section-burn">
        {!isChatMode ? (
          completionMessage && (
            <div className="px-6 py-4">
              <div className="flex h-4.5 items-center space-x-3">
                <div className="system-xs-semibold-uppercase text-text-tertiary">
                  {t(($) => $['table.header.output'], { ns: 'appLog' })}
                </div>
                <div
                  className="h-px grow"
                  style={{
                    background:
                      'linear-gradient(270deg, rgba(243, 244, 246, 0) 0%, rgb(243, 244, 246) 100%)',
                  }}
                ></div>
              </div>
              <TextGeneration
                appSourceType={AppSourceType.webApp}
                className="mt-2"
                content={completionMessage.answer}
                messageId={completionMessage.id}
                isError={false}
                onRetry={noop}
                supportFeedback
                feedback={getAdminFeedback(completionMessage.feedbacks)}
                onFeedback={(feedback) => {
                  onFeedback(completionMessage.id, feedback).catch(noop)
                }}
                isShowTextToSpeech
                siteInfo={null}
              />
            </div>
          )
        ) : threadChatItems.length < MIN_ITEMS_FOR_SCROLL_LOADING ? (
          <div className="mb-4 pt-4">
            <Chat
              config={
                {
                  appId: appDetail.id,
                  text_to_speech: {
                    enabled: true,
                  },
                  questionEditEnable: false,
                  supportAnnotation: true,
                  annotation_reply: {
                    enabled: true,
                  },
                  supportFeedback: true,
                } as ChatConfig
              }
              chatList={threadChatItems}
              onAnnotationAdded={handleAnnotationAdded}
              onAnnotationEdited={handleAnnotationEdited}
              onAnnotationRemoved={handleAnnotationRemoved}
              onFeedback={onFeedback}
              noChatInput
              onOpenLog={isAdvanced ? setSelectedLogItem : undefined}
              hideProcessDetail
              chatContainerInnerClassName="px-3"
              switchSibling={switchSibling}
            />
          </div>
        ) : (
          <div
            className="py-4"
            id="scrollableDiv"
            role="log"
            aria-live="off"
            style={{
              display: 'flex',
              flexDirection: 'column-reverse',
              height: '100%',
              overflow: 'auto',
            }}
            onScroll={handleScroll}
          >
            {/* Put the scroll bar always on the bottom */}
            <div className="flex w-full flex-col-reverse" style={{ position: 'relative' }}>
              <Chat
                config={
                  {
                    appId: appDetail.id,
                    text_to_speech: {
                      enabled: true,
                    },
                    questionEditEnable: false,
                    supportAnnotation: true,
                    annotation_reply: {
                      enabled: true,
                    },
                    supportFeedback: true,
                  } as ChatConfig
                }
                chatList={threadChatItems}
                onAnnotationAdded={handleAnnotationAdded}
                onAnnotationEdited={handleAnnotationEdited}
                onAnnotationRemoved={handleAnnotationRemoved}
                onFeedback={onFeedback}
                noChatInput
                onOpenLog={isAdvanced ? setSelectedLogItem : undefined}
                hideProcessDetail
                chatContainerInnerClassName="px-3"
                switchSibling={switchSibling}
              />
            </div>
            {isLoading && (
              <div className="py-3 text-center">
                <div className="system-xs-regular text-text-tertiary">
                  {t(($) => $['detail.loading'], { ns: 'appLog' })}
                  ...
                </div>
              </div>
            )}
          </div>
        )}
      </div>
      {logKind === 'workflow' && (
        <WorkflowContextProvider>
          <MessageLogModal
            appId={appDetail.id}
            width={width}
            currentLogItem={selectedLogItem}
            onCancel={() => setSelectedLogItem(undefined)}
          />
        </WorkflowContextProvider>
      )}
      {logKind === 'agent' && (
        <AgentLogModal
          appId={appDetail.id}
          floating
          width={width}
          currentLogItem={selectedLogItem}
          onCancel={() => setSelectedLogItem(undefined)}
        />
      )}
      {logKind === 'prompt' && (
        <PromptLogModal
          width={width}
          currentLogItem={selectedLogItem}
          onCancel={() => setSelectedLogItem(undefined)}
        />
      )}
    </div>
  )
}

type ConversationDetailProps = {
  appDetail: AppDetailWithSite
  conversationId: string
  onClose: () => void
}

export function ConversationDetail({
  appDetail,
  conversationId,
  onClose,
}: ConversationDetailProps) {
  const { t } = useTranslation(['appLog', 'common'])
  const { formatTime } = useTimestamp()
  const isChatMode = appDetail.mode !== 'completion'
  const input = { params: { app_id: appDetail.id, conversation_id: conversationId } }
  const chat = useQuery(
    consoleQuery.apps.byAppId.chatConversations.byConversationId.get.queryOptions({
      input: isChatMode ? input : skipToken,
    }),
  )
  const completion = useQuery(
    consoleQuery.apps.byAppId.completionConversations.byConversationId.get.queryOptions({
      input: !isChatMode ? input : skipToken,
    }),
  )
  const detailQuery = isChatMode ? chat : completion
  const detail = detailQuery.data
  const modelInfo = getLogModelInfo(detail?.model_config?.model)
  const handleFeedback: FeedbackFunc = async (messageId, { rating, content }) => {
    await consoleClient.apps.byAppId.feedbacks.post({
      params: { app_id: appDetail.id },
      body: { message_id: messageId, rating, content: content ?? undefined },
    })
    if (!isChatMode) await completion.refetch()
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col rounded-xl border-[0.5px] border-components-panel-border">
      <div className="flex shrink-0 items-center gap-2 rounded-t-xl bg-components-panel-bg pt-3 pr-3 pb-2 pl-4">
        <div className="min-w-0">
          <DialogTitle className="sr-only">
            {isChatMode
              ? t(($) => $['detail.conversationId'], { ns: 'appLog' })
              : t(($) => $['detail.time'], { ns: 'appLog' })}
          </DialogTitle>
          <div aria-hidden="true" className="mb-0.5 system-xs-semibold-uppercase text-text-primary">
            {isChatMode
              ? t(($) => $['detail.conversationId'], { ns: 'appLog' })
              : t(($) => $['detail.time'], { ns: 'appLog' })}
          </div>
          {isChatMode ? (
            <div className="flex items-center system-2xs-regular-uppercase text-text-secondary">
              <Tooltip>
                <TooltipTrigger render={<span className="truncate">{conversationId}</span>} />
                <TooltipContent>{conversationId}</TooltipContent>
              </Tooltip>
              <CopyIcon content={conversationId} />
            </div>
          ) : (
            <div className="min-h-4 system-2xs-regular-uppercase text-text-secondary">
              {detail?.created_at
                ? formatTime(
                    detail.created_at,
                    t(($) => $.dateTimeFormat, { ns: 'appLog' }),
                  )
                : null}
            </div>
          )}
        </div>
        <div className="flex grow flex-wrap items-center justify-end gap-y-1">
          <Suspense fallback={null}>
            {appDetail.mode !== 'advanced-chat' && modelInfo && <ModelInfo model={modelInfo} />}
          </Suspense>
        </div>
        <IconButton
          size="lg"
          aria-label={t(($) => $['operation.close'], { ns: 'common' })}
          onClick={onClose}
        >
          <span aria-hidden className="i-ri-close-line size-4 text-text-tertiary" />
        </IconButton>
      </div>
      <QueryErrorResetBoundary>
        {({ reset }) => (
          <ErrorBoundary
            onReset={reset}
            fallback={(_, retry) => (
              <div
                role="alert"
                className="flex flex-1 flex-col items-center justify-center gap-3 p-6"
              >
                <p>{t(($) => $['errorBoundary.title'], { ns: 'common' })}</p>
                <Button onClick={retry}>{t(($) => $['operation.retry'], { ns: 'common' })}</Button>
              </div>
            )}
          >
            <Suspense fallback={<ConversationSkeleton />}>
              {isChatMode ? (
                <ChatConversationContent
                  appDetail={appDetail}
                  conversationId={conversationId}
                  onFeedback={handleFeedback}
                />
              ) : (
                <CompletionConversationContent
                  appDetail={appDetail}
                  conversationId={conversationId}
                  onFeedback={handleFeedback}
                />
              )}
            </Suspense>
          </ErrorBoundary>
        )}
      </QueryErrorResetBoundary>
    </div>
  )
}

type ConversationContentProps = Omit<ConversationDetailProps, 'onClose'> & {
  onFeedback: FeedbackFunc
}

function ChatConversationContent({
  appDetail,
  conversationId,
  onFeedback,
}: ConversationContentProps) {
  const [detail, messages] = useSuspenseQueries({
    queries: [
      consoleQuery.apps.byAppId.chatConversations.byConversationId.get.queryOptions({
        input: { params: { app_id: appDetail.id, conversation_id: conversationId } },
      }),
      consoleQuery.apps.byAppId.chatMessages.get.queryOptions({
        input: {
          params: { app_id: appDetail.id },
          query: { conversation_id: conversationId, limit: 10 },
        },
        // Preserve edits during this session; reopening fetches a fresh snapshot.
        staleTime: Infinity,
        gcTime: 0,
      }),
    ],
  })
  return (
    <DetailPanel
      appDetail={appDetail}
      detail={detail.data}
      initialMessages={messages.data}
      onFeedback={onFeedback}
    />
  )
}

function CompletionConversationContent({
  appDetail,
  conversationId,
  onFeedback,
}: ConversationContentProps) {
  const { data } = useSuspenseQuery(
    consoleQuery.apps.byAppId.completionConversations.byConversationId.get.queryOptions({
      input: { params: { app_id: appDetail.id, conversation_id: conversationId } },
    }),
  )
  return <DetailPanel appDetail={appDetail} detail={data} onFeedback={onFeedback} />
}
