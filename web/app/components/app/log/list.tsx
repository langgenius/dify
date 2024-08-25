'use client'
import type { FC } from 'react'
import React, { useCallback, useEffect, useRef, useState } from 'react'
import useSWR from 'swr'
import {
  HandThumbDownIcon,
  HandThumbUpIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline'
import { RiEditFill, RiQuestionLine } from '@remixicon/react'
import { get } from 'lodash-es'
import InfiniteScroll from 'react-infinite-scroll-component'
import dayjs from 'dayjs'
import utc from 'dayjs/plugin/utc'
import timezone from 'dayjs/plugin/timezone'
import { createContext, useContext } from 'use-context-selector'
import { useShallow } from 'zustand/react/shallow'
import { useTranslation } from 'react-i18next'
import s from './style.module.css'
import VarPanel from './var-panel'
import cn from '@/utils/classnames'
import type { FeedbackFunc, Feedbacktype, IChatItem, SubmitAnnotationFunc } from '@/app/components/base/chat/chat/type'
import type { Annotation, ChatConversationFullDetailResponse, ChatConversationGeneralDetail, ChatConversationsResponse, ChatMessage, ChatMessagesRequest, CompletionConversationFullDetailResponse, CompletionConversationGeneralDetail, CompletionConversationsResponse, LogAnnotation } from '@/models/log'
import type { App } from '@/types/app'
import Loading from '@/app/components/base/loading'
import Drawer from '@/app/components/base/drawer'
import Popover from '@/app/components/base/popover'
import Chat from '@/app/components/base/chat/chat'
import { ToastContext } from '@/app/components/base/toast'
import { fetchChatConversationDetail, fetchChatMessages, fetchCompletionConversationDetail, updateLogMessageAnnotations, updateLogMessageFeedbacks } from '@/service/log'
import { TONE_LIST } from '@/config'
import ModelIcon from '@/app/components/header/account-setting/model-provider-page/model-icon'
import { useTextGenerationCurrentProviderAndModelAndModelList } from '@/app/components/header/account-setting/model-provider-page/hooks'
import ModelName from '@/app/components/header/account-setting/model-provider-page/model-name'
import useBreakpoints, { MediaType } from '@/hooks/use-breakpoints'
import TextGeneration from '@/app/components/app/text-generate/item'
import { addFileInfos, sortAgentSorts } from '@/app/components/tools/utils'
import MessageLogModal from '@/app/components/base/message-log-modal'
import { useStore as useAppStore } from '@/app/components/app/store'
import { useAppContext } from '@/context/app-context'
import useTimestamp from '@/hooks/use-timestamp'
import Tooltip from '@/app/components/base/tooltip'
import { CopyIcon } from '@/app/components/base/copy-icon'

dayjs.extend(utc)
dayjs.extend(timezone)

type IConversationList = {
  logs?: ChatConversationsResponse | CompletionConversationsResponse
  appDetail: App
  onRefresh: () => void
}

const defaultValue = 'N/A'

type IDrawerContext = {
  onClose: () => void
  appDetail?: App
}

const DrawerContext = createContext<IDrawerContext>({} as IDrawerContext)

/**
 * Icon component with numbers
 */
const HandThumbIconWithCount: FC<{ count: number; iconType: 'up' | 'down' }> = ({ count, iconType }) => {
  const classname = iconType === 'up' ? 'text-primary-600 bg-primary-50' : 'text-red-600 bg-red-50'
  const Icon = iconType === 'up' ? HandThumbUpIcon : HandThumbDownIcon
  return <div className={`inline-flex items-center w-fit rounded-md p-1 text-xs ${classname} mr-1 last:mr-0`}>
    <Icon className={'h-3 w-3 mr-0.5 rounded-md'} />
    {count > 0 ? count : null}
  </div>
}

const PARAM_MAP = {
  temperature: 'Temperature',
  top_p: 'Top P',
  presence_penalty: 'Presence Penalty',
  max_tokens: 'Max Token',
  stop: 'Stop',
  frequency_penalty: 'Frequency Penalty',
}

// Format interface data for easy display
const getFormattedChatList = (messages: ChatMessage[], conversationId: string, timezone: string, format: string) => {
  const newChatList: IChatItem[] = []
  messages.forEach((item: ChatMessage) => {
    newChatList.push({
      id: `question-${item.id}`,
      content: item.inputs.query || item.inputs.default_input || item.query, // text generation: item.inputs.query; chat: item.query
      isAnswer: false,
      message_files: item.message_files?.filter((file: any) => file.belongs_to === 'user') || [],
    })
    newChatList.push({
      id: item.id,
      content: item.answer,
      agent_thoughts: addFileInfos(item.agent_thoughts ? sortAgentSorts(item.agent_thoughts) : item.agent_thoughts, item.message_files),
      feedback: item.feedbacks.find(item => item.from_source === 'user'), // user feedback
      adminFeedback: item.feedbacks.find(item => item.from_source === 'admin'), // admin feedback
      feedbackDisabled: false,
      isAnswer: true,
      message_files: item.message_files?.filter((file: any) => file.belongs_to === 'assistant') || [],
      log: [
        ...item.message,
        ...(item.message[item.message.length - 1]?.role !== 'assistant'
          ? [
            {
              role: 'assistant',
              text: item.answer,
              files: item.message_files?.filter((file: any) => file.belongs_to === 'assistant') || [],
            },
          ]
          : []),
      ],
      workflow_run_id: item.workflow_run_id,
      conversationId,
      input: {
        inputs: item.inputs,
        query: item.query,
      },
      more: {
        time: dayjs.unix(item.created_at).tz(timezone).format(format),
        tokens: item.answer_tokens + item.message_tokens,
        latency: item.provider_response_latency.toFixed(2),
      },
      citation: item.metadata?.retriever_resources,
      annotation: (() => {
        if (item.annotation_hit_history) {
          return {
            id: item.annotation_hit_history.annotation_id,
            authorName: item.annotation_hit_history.annotation_create_account?.name || 'N/A',
            created_at: item.annotation_hit_history.created_at,
          }
        }

        if (item.annotation) {
          return {
            id: item.annotation.id,
            authorName: item.annotation.account.name,
            logAnnotation: item.annotation,
            created_at: 0,
          }
        }

        return undefined
      })(),
    })
  })
  return newChatList
}

// const displayedParams = CompletionParams.slice(0, -2)
const validatedParams = ['temperature', 'top_p', 'presence_penalty', 'frequency_penalty']

type IDetailPanel<T> = {
  detail: any
  onFeedback: FeedbackFunc
  onSubmitAnnotation: SubmitAnnotationFunc
}

function DetailPanel<T extends ChatConversationFullDetailResponse | CompletionConversationFullDetailResponse>({ detail, onFeedback }: IDetailPanel<T>) {
  const { userProfile: { timezone } } = useAppContext()
  const { formatTime } = useTimestamp()
  const { onClose, appDetail } = useContext(DrawerContext)
  const { currentLogItem, setCurrentLogItem, showMessageLogModal, setShowMessageLogModal, currentLogModalActiveTab } = useAppStore(useShallow(state => ({
    currentLogItem: state.currentLogItem,
    setCurrentLogItem: state.setCurrentLogItem,
    showMessageLogModal: state.showMessageLogModal,
    setShowMessageLogModal: state.setShowMessageLogModal,
    currentLogModalActiveTab: state.currentLogModalActiveTab,
  })))
  const { t } = useTranslation()
  const [items, setItems] = React.useState<IChatItem[]>([])
  const [hasMore, setHasMore] = useState(true)
  const [varValues, setVarValues] = useState<Record<string, string>>({})
  const fetchData = async () => {
    try {
      if (!hasMore)
        return
      const params: ChatMessagesRequest = {
        conversation_id: detail.id,
        limit: 10,
      }
      if (items?.[0]?.id)
        params.first_id = items?.[0]?.id.replace('question-', '')

      const messageRes = await fetchChatMessages({
        url: `/apps/${appDetail?.id}/chat-messages`,
        params,
      })
      if (messageRes.data.length > 0) {
        const varValues = messageRes.data[0].inputs
        setVarValues(varValues)
      }
      const newItems = [...getFormattedChatList(messageRes.data, detail.id, timezone!, t('appLog.dateTimeFormat') as string), ...items]
      if (messageRes.has_more === false && detail?.model_config?.configs?.introduction) {
        newItems.unshift({
          id: 'introduction',
          isAnswer: true,
          isOpeningStatement: true,
          content: detail?.model_config?.configs?.introduction ?? 'hello',
          feedbackDisabled: true,
        })
      }
      setItems(newItems)
      setHasMore(messageRes.has_more)
    }
    catch (err) {
      console.error(err)
    }
  }

  const handleAnnotationEdited = useCallback((query: string, answer: string, index: number) => {
    setItems(items.map((item, i) => {
      if (i === index - 1) {
        return {
          ...item,
          content: query,
        }
      }
      if (i === index) {
        return {
          ...item,
          annotation: {
            ...item.annotation,
            logAnnotation: {
              ...item.annotation?.logAnnotation,
              content: answer,
            },
          } as any,
        }
      }
      return item
    }))
  }, [items])
  const handleAnnotationAdded = useCallback((annotationId: string, authorName: string, query: string, answer: string, index: number) => {
    setItems(items.map((item, i) => {
      if (i === index - 1) {
        return {
          ...item,
          content: query,
        }
      }
      if (i === index) {
        const answerItem = {
          ...item,
          content: item.content,
          annotation: {
            id: annotationId,
            authorName,
            logAnnotation: {
              content: answer,
              account: {
                id: '',
                name: authorName,
                email: '',
              },
            },
          } as Annotation,
        }
        return answerItem
      }
      return item
    }))
  }, [items])
  const handleAnnotationRemoved = useCallback((index: number) => {
    setItems(items.map((item, i) => {
      if (i === index) {
        return {
          ...item,
          content: item.content,
          annotation: undefined,
        }
      }
      return item
    }))
  }, [items])

  useEffect(() => {
    if (appDetail?.id && detail.id && appDetail?.mode !== 'completion')
      fetchData()
  }, [appDetail?.id, detail.id, appDetail?.mode])

  const isChatMode = appDetail?.mode !== 'completion'
  const isAdvanced = appDetail?.mode === 'advanced-chat'

  const targetTone = TONE_LIST.find((item: any) => {
    let res = true
    validatedParams.forEach((param) => {
      res = item.config?.[param] === detail.model_config?.configs?.completion_params?.[param]
    })
    return res
  })?.name ?? 'custom'

  const modelName = (detail.model_config as any).model?.name
  const provideName = (detail.model_config as any).model?.provider as any
  const {
    currentModel,
    currentProvider,
  } = useTextGenerationCurrentProviderAndModelAndModelList(
    { provider: provideName, model: modelName },
  )
  const varList = (detail.model_config as any).user_input_form?.map((item: any) => {
    const itemContent = item[Object.keys(item)[0]]
    return {
      label: itemContent.variable,
      value: varValues[itemContent.variable] || detail.message?.inputs?.[itemContent.variable],
    }
  }) || []
  const message_files = (!isChatMode && detail.message.message_files && detail.message.message_files.length > 0)
    ? detail.message.message_files.map((item: any) => item.url)
    : []

  const getParamValue = (param: string) => {
    const value = detail?.model_config.model?.completion_params?.[param] || '-'
    if (param === 'stop') {
      if (Array.isArray(value))
        return value.join(',')
      else
        return '-'
    }

    return value
  }

  const [width, setWidth] = useState(0)
  const ref = useRef<HTMLDivElement>(null)

  const adjustModalWidth = () => {
    if (ref.current)
      setWidth(document.body.clientWidth - (ref.current?.clientWidth + 16) - 8)
  }

  useEffect(() => {
    adjustModalWidth()
  }, [])

  return (
    <div ref={ref} className='rounded-xl border-[0.5px] border-gray-200 h-full flex flex-col overflow-auto'>
      {/* Panel Header */}
      <div className='border-b border-gray-100 py-4 px-6 flex items-center justify-between'>
        <div>
          <div className='text-gray-500 text-[10px] leading-[14px]'>{isChatMode ? t('appLog.detail.conversationId') : t('appLog.detail.time')}</div>
          {isChatMode && (
            <div className='flex items-center text-gray-700 text-[13px] leading-[18px]'>
              <Tooltip
                popupContent={detail.id}
              >
                <div className='max-w-[105px] truncate'>{detail.id}</div>
              </Tooltip>
              <CopyIcon content={detail.id} />
            </div>
          )}
          {!isChatMode && (
            <div className='text-gray-700 text-[13px] leading-[18px]'>{formatTime(detail.created_at, t('appLog.dateTimeFormat') as string)}</div>
          )}
        </div>
        <div className='flex items-center flex-wrap gap-y-1 justify-end'>
          {!isAdvanced && (
            <>
              <div
                className={cn('mr-2 flex items-center border h-8 px-2 space-x-2 rounded-lg bg-indigo-25 border-[#2A87F5]')}
              >
                <ModelIcon
                  className='!w-5 !h-5'
                  provider={currentProvider}
                  modelName={currentModel?.model}
                />
                <ModelName
                  modelItem={currentModel!}
                  showMode
                />
              </div>
              <Popover
                position='br'
                className='!w-[280px]'
                btnClassName='mr-4 !bg-gray-50 !py-1.5 !px-2.5 border-none font-normal'
                btnElement={<>
                  <span className='text-[13px]'>{targetTone}</span>
                  <RiQuestionLine className='h-4 w-4 text-gray-800 ml-1.5' />
                </>}
                htmlContent={<div className='w-[280px]'>
                  <div className='flex justify-between py-2 px-4 font-medium text-sm text-gray-700'>
                    <span>Tone of responses</span>
                    <div>{targetTone}</div>
                  </div>
                  {['temperature', 'top_p', 'presence_penalty', 'max_tokens', 'stop'].map((param: string, index: number) => {
                    return <div className='flex justify-between py-2 px-4 bg-gray-50' key={index}>
                      <span className='text-xs text-gray-700'>{PARAM_MAP[param as keyof typeof PARAM_MAP]}</span>
                      <span className='text-gray-800 font-medium text-xs'>{getParamValue(param)}</span>
                    </div>
                  })}
                </div>}
              />
            </>
          )}
          <div className='w-6 h-6 rounded-lg flex items-center justify-center hover:cursor-pointer hover:bg-gray-100'>
            <XMarkIcon className='w-4 h-4 text-gray-500' onClick={onClose} />
          </div>
        </div>

      </div>
      {/* Panel Body */}
      {(varList.length > 0 || (!isChatMode && message_files.length > 0)) && (
        <div className='px-6 pt-4 pb-2'>
          <VarPanel
            varList={varList}
            message_files={message_files}
          />
        </div>
      )}

      {!isChatMode
        ? <div className="px-6 py-4">
          <div className='flex h-[18px] items-center space-x-3'>
            <div className='leading-[18px] text-xs font-semibold text-gray-500 uppercase'>{t('appLog.table.header.output')}</div>
            <div className='grow h-[1px]' style={{
              background: 'linear-gradient(270deg, rgba(243, 244, 246, 0) 0%, rgb(243, 244, 246) 100%)',
            }}></div>
          </div>
          <TextGeneration
            className='mt-2'
            content={detail.message.answer}
            messageId={detail.message.id}
            isError={false}
            onRetry={() => { }}
            isInstalledApp={false}
            supportFeedback
            feedback={detail.message.feedbacks.find((item: any) => item.from_source === 'admin')}
            onFeedback={feedback => onFeedback(detail.message.id, feedback)}
            supportAnnotation
            isShowTextToSpeech
            appId={appDetail?.id}
            varList={varList}
            siteInfo={null}
          />
        </div>
        : items.length < 8
          ? <div className="pt-4 mb-4">
            <Chat
              config={{
                appId: appDetail?.id,
                text_to_speech: {
                  enabled: true,
                },
                supportAnnotation: true,
                annotation_reply: {
                  enabled: true,
                },
                supportFeedback: true,
              } as any}
              chatList={items}
              onAnnotationAdded={handleAnnotationAdded}
              onAnnotationEdited={handleAnnotationEdited}
              onAnnotationRemoved={handleAnnotationRemoved}
              onFeedback={onFeedback}
              noChatInput
              showPromptLog
              hideProcessDetail
              chatContainerInnerClassName='px-6'
            />
          </div>
          : <div
            className="py-4"
            id="scrollableDiv"
            style={{
              height: 1000, // Specify a value
              overflow: 'auto',
              display: 'flex',
              flexDirection: 'column-reverse',
            }}>
            {/* Put the scroll bar always on the bottom */}
            <InfiniteScroll
              scrollableTarget="scrollableDiv"
              dataLength={items.length}
              next={fetchData}
              hasMore={hasMore}
              loader={<div className='text-center text-gray-400 text-xs'>{t('appLog.detail.loading')}...</div>}
              // endMessage={<div className='text-center'>Nothing more to show</div>}
              // below props only if you need pull down functionality
              refreshFunction={fetchData}
              pullDownToRefresh
              pullDownToRefreshThreshold={50}
              // pullDownToRefreshContent={
              //   <div className='text-center'>Pull down to refresh</div>
              // }
              // releaseToRefreshContent={
              //   <div className='text-center'>Release to refresh</div>
              // }
              // To put endMessage and loader to the top.
              style={{ display: 'flex', flexDirection: 'column-reverse' }}
              inverse={true}
            >
              <Chat
                config={{
                  appId: appDetail?.id,
                  text_to_speech: {
                    enabled: true,
                  },
                  supportAnnotation: true,
                  annotation_reply: {
                    enabled: true,
                  },
                  supportFeedback: true,
                } as any}
                chatList={items}
                onAnnotationAdded={handleAnnotationAdded}
                onAnnotationEdited={handleAnnotationEdited}
                onAnnotationRemoved={handleAnnotationRemoved}
                onFeedback={onFeedback}
                noChatInput
                showPromptLog
                hideProcessDetail
                chatContainerInnerClassName='px-6'
              />
            </InfiniteScroll>
          </div>
      }
      {showMessageLogModal && (
        <MessageLogModal
          width={width}
          currentLogItem={currentLogItem}
          onCancel={() => {
            setCurrentLogItem()
            setShowMessageLogModal(false)
          }}
          defaultTab={currentLogModalActiveTab}
        />
      )}
    </div>
  )
}

/**
 * Text App Conversation Detail Component
 */
const CompletionConversationDetailComp: FC<{ appId?: string; conversationId?: string }> = ({ appId, conversationId }) => {
  // Text Generator App Session Details Including Message List
  const detailParams = ({ url: `/apps/${appId}/completion-conversations/${conversationId}` })
  const { data: conversationDetail, mutate: conversationDetailMutate } = useSWR(() => (appId && conversationId) ? detailParams : null, fetchCompletionConversationDetail)
  const { notify } = useContext(ToastContext)
  const { t } = useTranslation()

  const handleFeedback = async (mid: string, { rating }: Feedbacktype): Promise<boolean> => {
    try {
      await updateLogMessageFeedbacks({ url: `/apps/${appId}/feedbacks`, body: { message_id: mid, rating } })
      conversationDetailMutate()
      notify({ type: 'success', message: t('common.actionMsg.modifiedSuccessfully') })
      return true
    }
    catch (err) {
      notify({ type: 'error', message: t('common.actionMsg.modifiedUnsuccessfully') })
      return false
    }
  }

  const handleAnnotation = async (mid: string, value: string): Promise<boolean> => {
    try {
      await updateLogMessageAnnotations({ url: `/apps/${appId}/annotations`, body: { message_id: mid, content: value } })
      conversationDetailMutate()
      notify({ type: 'success', message: t('common.actionMsg.modifiedSuccessfully') })
      return true
    }
    catch (err) {
      notify({ type: 'error', message: t('common.actionMsg.modifiedUnsuccessfully') })
      return false
    }
  }

  if (!conversationDetail)
    return null

  return <DetailPanel<CompletionConversationFullDetailResponse>
    detail={conversationDetail}
    onFeedback={handleFeedback}
    onSubmitAnnotation={handleAnnotation}
  />
}

/**
 * Chat App Conversation Detail Component
 */
const ChatConversationDetailComp: FC<{ appId?: string; conversationId?: string }> = ({ appId, conversationId }) => {
  const detailParams = { url: `/apps/${appId}/chat-conversations/${conversationId}` }
  const { data: conversationDetail } = useSWR(() => (appId && conversationId) ? detailParams : null, fetchChatConversationDetail)
  const { notify } = useContext(ToastContext)
  const { t } = useTranslation()

  const handleFeedback = async (mid: string, { rating }: Feedbacktype): Promise<boolean> => {
    try {
      await updateLogMessageFeedbacks({ url: `/apps/${appId}/feedbacks`, body: { message_id: mid, rating } })
      notify({ type: 'success', message: t('common.actionMsg.modifiedSuccessfully') })
      return true
    }
    catch (err) {
      notify({ type: 'error', message: t('common.actionMsg.modifiedUnsuccessfully') })
      return false
    }
  }

  const handleAnnotation = async (mid: string, value: string): Promise<boolean> => {
    try {
      await updateLogMessageAnnotations({ url: `/apps/${appId}/annotations`, body: { message_id: mid, content: value } })
      notify({ type: 'success', message: t('common.actionMsg.modifiedSuccessfully') })
      return true
    }
    catch (err) {
      notify({ type: 'error', message: t('common.actionMsg.modifiedUnsuccessfully') })
      return false
    }
  }

  if (!conversationDetail)
    return null

  return <DetailPanel<ChatConversationFullDetailResponse>
    detail={conversationDetail}
    onFeedback={handleFeedback}
    onSubmitAnnotation={handleAnnotation}
  />
}

/**
 * Conversation list component including basic information
 */
const ConversationList: FC<IConversationList> = ({ logs, appDetail, onRefresh }) => {
  const { t } = useTranslation()
  const { formatTime } = useTimestamp()

  const media = useBreakpoints()
  const isMobile = media === MediaType.mobile

  const [showDrawer, setShowDrawer] = useState<boolean>(false) // Whether to display the chat details drawer
  const [currentConversation, setCurrentConversation] = useState<ChatConversationGeneralDetail | CompletionConversationGeneralDetail | undefined>() // Currently selected conversation
  const isChatMode = appDetail.mode !== 'completion' // Whether the app is a chat app

  // Annotated data needs to be highlighted
  const renderTdValue = (value: string | number | null, isEmptyStyle: boolean, isHighlight = false, annotation?: LogAnnotation) => {
    return (
      <Tooltip
        popupContent={
          <span className='text-xs text-gray-500 inline-flex items-center'>
            <RiEditFill className='w-3 h-3 mr-1' />{`${t('appLog.detail.annotationTip', { user: annotation?.account?.name })} ${formatTime(annotation?.created_at || dayjs().unix(), 'MM-DD hh:mm A')}`}
          </span>
        }
        popupClassName={(isHighlight && !isChatMode) ? '' : '!hidden'}
      >
        <div className={cn(isEmptyStyle ? 'text-gray-400' : 'text-gray-700', !isHighlight ? '' : 'bg-orange-100', 'text-sm overflow-hidden text-ellipsis whitespace-nowrap')}>
          {value || '-'}
        </div>
      </Tooltip>
    )
  }

  const onCloseDrawer = () => {
    onRefresh()
    setShowDrawer(false)
    setCurrentConversation(undefined)
  }

  if (!logs)
    return <Loading />

  return (
    <div className='overflow-x-auto'>
      <table className={`w-full min-w-[440px] border-collapse border-0 text-sm mt-3 ${s.logTable}`}>
        <thead className="h-8 leading-8 border-b border-gray-200 text-gray-500 font-bold">
          <tr>
            <td className='w-[1.375rem] whitespace-nowrap'></td>
            <td className='whitespace-nowrap'>{isChatMode ? t('appLog.table.header.summary') : t('appLog.table.header.input')}</td>
            <td className='whitespace-nowrap'>{t('appLog.table.header.endUser')}</td>
            <td className='whitespace-nowrap'>{isChatMode ? t('appLog.table.header.messageCount') : t('appLog.table.header.output')}</td>
            <td className='whitespace-nowrap'>{t('appLog.table.header.userRate')}</td>
            <td className='whitespace-nowrap'>{t('appLog.table.header.adminRate')}</td>
            <td className='whitespace-nowrap'>{t('appLog.table.header.updatedTime')}</td>
            <td className='whitespace-nowrap'>{t('appLog.table.header.time')}</td>
          </tr>
        </thead>
        <tbody className="text-gray-500">
          {logs.data.map((log: any) => {
            const endUser = log.from_end_user_session_id || log.from_account_name
            const leftValue = get(log, isChatMode ? 'name' : 'message.inputs.query') || (!isChatMode ? (get(log, 'message.query') || get(log, 'message.inputs.default_input')) : '') || ''
            const rightValue = get(log, isChatMode ? 'message_count' : 'message.answer')
            return <tr
              key={log.id}
              className={`border-b border-gray-200 h-8 hover:bg-gray-50 cursor-pointer ${currentConversation?.id !== log.id ? '' : 'bg-gray-50'}`}
              onClick={() => {
                setShowDrawer(true)
                setCurrentConversation(log)
              }}>
              <td className='text-center align-middle'>{!log.read_at && <span className='inline-block bg-[#3F83F8] h-1.5 w-1.5 rounded'></span>}</td>
              <td style={{ maxWidth: isChatMode ? 300 : 200 }}>
                {renderTdValue(leftValue || t('appLog.table.empty.noChat'), !leftValue, isChatMode && log.annotated)}
              </td>
              <td>{renderTdValue(endUser || defaultValue, !endUser)}</td>
              <td style={{ maxWidth: isChatMode ? 100 : 200 }}>
                {renderTdValue(rightValue === 0 ? 0 : (rightValue || t('appLog.table.empty.noOutput')), !rightValue, !isChatMode && !!log.annotation?.content, log.annotation)}
              </td>
              <td>
                {(!log.user_feedback_stats.like && !log.user_feedback_stats.dislike)
                  ? renderTdValue(defaultValue, true)
                  : <>
                    {!!log.user_feedback_stats.like && <HandThumbIconWithCount iconType='up' count={log.user_feedback_stats.like} />}
                    {!!log.user_feedback_stats.dislike && <HandThumbIconWithCount iconType='down' count={log.user_feedback_stats.dislike} />}
                  </>
                }
              </td>
              <td>
                {(!log.admin_feedback_stats.like && !log.admin_feedback_stats.dislike)
                  ? renderTdValue(defaultValue, true)
                  : <>
                    {!!log.admin_feedback_stats.like && <HandThumbIconWithCount iconType='up' count={log.admin_feedback_stats.like} />}
                    {!!log.admin_feedback_stats.dislike && <HandThumbIconWithCount iconType='down' count={log.admin_feedback_stats.dislike} />}
                  </>
                }
              </td>
              <td className='w-[160px]'>{formatTime(log.updated_at, t('appLog.dateTimeFormat') as string)}</td>
              <td className='w-[160px]'>{formatTime(log.created_at, t('appLog.dateTimeFormat') as string)}</td>
            </tr>
          })}
        </tbody>
      </table>
      <Drawer
        isOpen={showDrawer}
        onClose={onCloseDrawer}
        mask={isMobile}
        footer={null}
        panelClassname='mt-16 mx-2 sm:mr-2 mb-4 !p-0 !max-w-[640px] rounded-xl'
      >
        <DrawerContext.Provider value={{
          onClose: onCloseDrawer,
          appDetail,
        }}>
          {isChatMode
            ? <ChatConversationDetailComp appId={appDetail.id} conversationId={currentConversation?.id} />
            : <CompletionConversationDetailComp appId={appDetail.id} conversationId={currentConversation?.id} />
          }
        </DrawerContext.Provider>
      </Drawer>
    </div>
  )
}

export default ConversationList
