'use client'

import type { DetailPanelProps } from './use-detail-panel-state'
import type { FeedbackType } from '@/app/components/base/chat/chat/type'
import type { CompletionConversationFullDetailResponse } from '@/models/log'
import type { App } from '@/types/app'
import { RiCloseLine } from '@remixicon/react'
import { noop } from 'es-toolkit/function'
import * as React from 'react'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import ModelInfo from '@/app/components/app/log/model-info'
import TextGeneration from '@/app/components/app/text-generate/item'
import ActionButton from '@/app/components/base/action-button'
import Chat from '@/app/components/base/chat/chat'
import CopyIcon from '@/app/components/base/copy-icon'
import MessageLogModal from '@/app/components/base/message-log-modal'
import { toast } from '@/app/components/base/ui/toast'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/app/components/base/ui/tooltip'
import { WorkflowContextProvider } from '@/app/components/workflow/context'
import { updateLogMessageFeedbacks } from '@/service/log'
import { AppSourceType } from '@/service/share'
import { useChatConversationDetail, useCompletionConversationDetail } from '@/service/use-log'
import PromptLogModal from '../../base/prompt-log-modal'
import { MIN_ITEMS_FOR_SCROLL_LOADING } from './list-utils'
import { useDetailPanelState } from './use-detail-panel-state'
import VarPanel from './var-panel'

function ListDetailPanel({ appDetail, detail, onClose, onFeedback }: DetailPanelProps) {
  const { t } = useTranslation()
  const {
    containerRef,
    currentLogItem,
    currentLogModalActiveTab,
    formatTime,
    handleAnnotationAdded,
    handleAnnotationEdited,
    handleAnnotationRemoved,
    handleScroll,
    hasMore,
    isAdvanced,
    isChatMode,
    messageDateTimeFormat,
    messageFiles,
    setCurrentLogItem,
    setShowMessageLogModal,
    setShowPromptLogModal,
    showMessageLogModal,
    showPromptLogModal,
    switchSibling,
    threadChatItems,
    varList,
    width,
  } = useDetailPanelState({ appDetail, detail })
  const completionDetail = isChatMode ? undefined : detail as CompletionConversationFullDetailResponse

  return (
    <div ref={containerRef} className="flex h-full flex-col rounded-xl border-[0.5px] border-components-panel-border">
      <div className="flex shrink-0 items-center gap-2 rounded-t-xl bg-components-panel-bg pb-2 pl-4 pr-3 pt-3">
        <div className="shrink-0">
          <div className="mb-0.5 text-text-primary system-xs-semibold-uppercase">
            {isChatMode ? t('detail.conversationId', { ns: 'appLog' }) : t('detail.time', { ns: 'appLog' })}
          </div>
          {isChatMode && (
            <div className="flex items-center text-text-secondary system-2xs-regular-uppercase">
              <Tooltip>
                <TooltipTrigger render={<div className="truncate">{detail.id}</div>} />
                <TooltipContent>{detail.id}</TooltipContent>
              </Tooltip>
              <CopyIcon content={detail.id} />
            </div>
          )}
          {!isChatMode && (
            <div className="text-text-secondary system-2xs-regular-uppercase">
              {formatTime(detail.created_at, messageDateTimeFormat)}
            </div>
          )}
        </div>
        <div className="flex grow flex-wrap items-center justify-end gap-y-1">
          {!isAdvanced && 'model' in detail.model_config && <ModelInfo model={detail.model_config.model} />}
        </div>
        <ActionButton size="l" onClick={onClose}>
          <RiCloseLine className="h-4 w-4 text-text-tertiary" />
        </ActionButton>
      </div>
      <div className="shrink-0 px-1 pt-1">
        <div className="rounded-t-xl bg-background-section-burn p-3 pb-2">
          {(varList.length > 0 || (!isChatMode && messageFiles.length > 0)) && (
            <VarPanel varList={varList} message_files={messageFiles} />
          )}
        </div>
      </div>
      <div className="mx-1 mb-1 grow overflow-auto rounded-b-xl bg-background-section-burn">
        {!isChatMode
          ? (
              <div className="px-6 py-4">
                <div className="flex h-[18px] items-center space-x-3">
                  <div className="text-text-tertiary system-xs-semibold-uppercase">{t('table.header.output', { ns: 'appLog' })}</div>
                  <div
                    className="h-px grow"
                    style={{ background: 'linear-gradient(270deg, rgba(243, 244, 246, 0) 0%, rgb(243, 244, 246) 100%)' }}
                  />
                </div>
                <TextGeneration
                  appSourceType={AppSourceType.webApp}
                  className="mt-2"
                  content={completionDetail?.message.answer ?? ''}
                  messageId={completionDetail?.message.id ?? ''}
                  isError={false}
                  onRetry={noop}
                  supportFeedback
                  feedback={completionDetail?.message.feedbacks.find(item => item.from_source === 'admin')}
                  onFeedback={feedback => onFeedback(completionDetail?.message.id ?? '', feedback)}
                  isShowTextToSpeech
                  siteInfo={null}
                />
              </div>
            )
          : threadChatItems.length < MIN_ITEMS_FOR_SCROLL_LOADING
            ? (
                <div className="mb-4 pt-4">
                  <Chat
                    config={{
                      appId: appDetail?.id,
                      text_to_speech: { enabled: true },
                      questionEditEnable: false,
                      supportAnnotation: true,
                      annotation_reply: { enabled: true },
                      supportFeedback: true,
                    } as never}
                    chatList={threadChatItems}
                    onAnnotationAdded={handleAnnotationAdded}
                    onAnnotationEdited={handleAnnotationEdited}
                    onAnnotationRemoved={handleAnnotationRemoved}
                    onFeedback={onFeedback}
                    noChatInput
                    showPromptLog
                    hideProcessDetail
                    chatContainerInnerClassName="px-3"
                    switchSibling={switchSibling}
                  />
                </div>
              )
            : (
                <div
                  id="scrollableDiv"
                  className="py-4"
                  style={{
                    display: 'flex',
                    flexDirection: 'column-reverse',
                    height: '100%',
                    overflow: 'auto',
                  }}
                  onScroll={handleScroll}
                >
                  <div className="flex w-full flex-col-reverse" style={{ position: 'relative' }}>
                    <Chat
                      config={{
                        appId: appDetail?.id,
                        text_to_speech: { enabled: true },
                        questionEditEnable: false,
                        supportAnnotation: true,
                        annotation_reply: { enabled: true },
                        supportFeedback: true,
                      } as never}
                      chatList={threadChatItems}
                      onAnnotationAdded={handleAnnotationAdded}
                      onAnnotationEdited={handleAnnotationEdited}
                      onAnnotationRemoved={handleAnnotationRemoved}
                      onFeedback={onFeedback}
                      noChatInput
                      showPromptLog
                      hideProcessDetail
                      chatContainerInnerClassName="px-3"
                      switchSibling={switchSibling}
                    />
                  </div>
                  {hasMore && (
                    <div className="py-3 text-center">
                      <div className="text-text-tertiary system-xs-regular">
                        {t('detail.loading', { ns: 'appLog' })}
                        ...
                      </div>
                    </div>
                  )}
                </div>
              )}
      </div>
      {showMessageLogModal && (
        <WorkflowContextProvider>
          <MessageLogModal
            width={width}
            currentLogItem={currentLogItem}
            onCancel={() => {
              setCurrentLogItem()
              setShowMessageLogModal(false)
            }}
            defaultTab={currentLogModalActiveTab}
          />
        </WorkflowContextProvider>
      )}
      {!isChatMode && showPromptLogModal && (
        <PromptLogModal
          width={width}
          currentLogItem={currentLogItem}
          onCancel={() => {
            setCurrentLogItem()
            setShowPromptLogModal(false)
          }}
        />
      )}
    </div>
  )
}

function useConversationMutationHandlers(appId: string | undefined, onAfterSuccess?: () => void) {
  const { t } = useTranslation()

  const handleFeedback = useCallback(async (messageId: string, { rating, content }: FeedbackType): Promise<boolean> => {
    try {
      await updateLogMessageFeedbacks({
        url: `/apps/${appId}/feedbacks`,
        body: { message_id: messageId, rating, content: content ?? undefined },
      })
      onAfterSuccess?.()
      toast.success(t('actionMsg.modifiedSuccessfully', { ns: 'common' }))
      return true
    }
    catch {
      toast.error(t('actionMsg.modifiedUnsuccessfully', { ns: 'common' }))
      return false
    }
  }, [appId, onAfterSuccess, t])

  return {
    handleFeedback,
  }
}

export const CompletionConversationDetailComp = ({ appDetail, conversationId, onClose }: { appDetail?: App, conversationId?: string, onClose: () => void }) => {
  const { data: conversationDetail, refetch } = useCompletionConversationDetail(appDetail?.id, conversationId)
  const { handleFeedback } = useConversationMutationHandlers(appDetail?.id, refetch)

  if (!conversationDetail)
    return null

  return (
    <ListDetailPanel
      detail={conversationDetail}
      appDetail={appDetail}
      onClose={onClose}
      onFeedback={handleFeedback}
    />
  )
}

export const ChatConversationDetailComp = ({ appDetail, conversationId, onClose }: { appDetail?: App, conversationId?: string, onClose: () => void }) => {
  const { data: conversationDetail } = useChatConversationDetail(appDetail?.id, conversationId)
  const { handleFeedback } = useConversationMutationHandlers(appDetail?.id)

  if (!conversationDetail)
    return null

  return (
    <ListDetailPanel
      detail={conversationDetail}
      appDetail={appDetail}
      onClose={onClose}
      onFeedback={handleFeedback}
    />
  )
}
