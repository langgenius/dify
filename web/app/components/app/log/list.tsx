'use client'
import type { FC } from 'react'
import React, { useEffect, useState } from 'react'
// import type { Log } from '@/models/log'
import useSWR from 'swr'
import {
  HandThumbDownIcon,
  HandThumbUpIcon,
  InformationCircleIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline'
import { get } from 'lodash-es'
import InfiniteScroll from 'react-infinite-scroll-component'
import dayjs from 'dayjs'
import { createContext, useContext } from 'use-context-selector'
import { useTranslation } from 'react-i18next'
import cn from 'classnames'
import s from './style.module.css'
import VarPanel from './var-panel'
import { randomString } from '@/utils'
import { EditIconSolid } from '@/app/components/app/chat/icon-component'
import type { FeedbackFunc, Feedbacktype, IChatItem, SubmitAnnotationFunc } from '@/app/components/app/chat/type'
import type { Annotation, ChatConversationFullDetailResponse, ChatConversationGeneralDetail, ChatConversationsResponse, ChatMessage, ChatMessagesRequest, CompletionConversationFullDetailResponse, CompletionConversationGeneralDetail, CompletionConversationsResponse } from '@/models/log'
import type { App } from '@/types/app'
import Loading from '@/app/components/base/loading'
import Drawer from '@/app/components/base/drawer'
import Popover from '@/app/components/base/popover'
import Chat from '@/app/components/app/chat'
import Tooltip from '@/app/components/base/tooltip'
import { ToastContext } from '@/app/components/base/toast'
import { fetchChatConversationDetail, fetchChatMessages, fetchCompletionConversationDetail, updateLogMessageAnnotations, updateLogMessageFeedbacks } from '@/service/log'
import { TONE_LIST } from '@/config'
import ModelIcon from '@/app/components/app/configuration/config-model/model-icon'
import ModelName from '@/app/components/app/configuration/config-model/model-name'
import ModelModeTypeLabel from '@/app/components/app/configuration/config-model/model-mode-type-label'
import { ModelModeType } from '@/types/app'

type IConversationList = {
  logs?: ChatConversationsResponse | CompletionConversationsResponse
  appDetail?: App
  onRefresh: () => void
}

const defaultValue = 'N/A'
const emptyText = '[Empty]'

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
const getFormattedChatList = (messages: ChatMessage[]) => {
  const newChatList: IChatItem[] = []
  messages.forEach((item: ChatMessage) => {
    newChatList.push({
      id: `question-${item.id}`,
      content: item.inputs.query || item.inputs.default_input || item.query, // text generation: item.inputs.query; chat: item.query
      isAnswer: false,
      log: item.message as any,
    })

    newChatList.push({
      id: item.id,
      content: item.answer,
      feedback: item.feedbacks.find(item => item.from_source === 'user'), // user feedback
      adminFeedback: item.feedbacks.find(item => item.from_source === 'admin'), // admin feedback
      feedbackDisabled: false,
      isAnswer: true,
      more: {
        time: dayjs.unix(item.created_at).format('hh:mm A'),
        tokens: item.answer_tokens + item.message_tokens,
        latency: item.provider_response_latency.toFixed(2),
      },
      annotation: item.annotation,
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

function DetailPanel<T extends ChatConversationFullDetailResponse | CompletionConversationFullDetailResponse>({ detail, onFeedback, onSubmitAnnotation }: IDetailPanel<T>) {
  const { onClose, appDetail } = useContext(DrawerContext)
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
        limit: 4,
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
      const newItems = [...getFormattedChatList(messageRes.data), ...items]
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

  useEffect(() => {
    if (appDetail?.id && detail.id && appDetail?.mode === 'chat')
      fetchData()
  }, [appDetail?.id, detail.id])

  const isChatMode = appDetail?.mode === 'chat'

  const targetTone = TONE_LIST.find((item: any) => {
    let res = true
    validatedParams.forEach((param) => {
      res = item.config?.[param] === detail.model_config?.configs?.completion_params?.[param]
    })
    return res
  })?.name ?? 'custom'

  const modelName = (detail.model_config as any).model.name
  const provideName = (detail.model_config as any).model.provider as any
  const varList = (detail.model_config as any).user_input_form.map((item: any) => {
    const itemContent = item[Object.keys(item)[0]]
    return {
      label: itemContent.variable,
      value: varValues[itemContent.variable],
    }
  })
  return (<div className='rounded-xl border-[0.5px] border-gray-200 h-full flex flex-col overflow-auto'>
    {/* Panel Header */}
    <div className='border-b border-gray-100 py-4 px-6 flex items-center justify-between'>
      <div>
        <div className='text-gray-500 text-[10px] leading-[14px]'>{isChatMode ? t('appLog.detail.conversationId') : t('appLog.detail.time')}</div>
        <div className='text-gray-700 text-[13px] leading-[18px]'>{isChatMode ? detail.id?.split('-').slice(-1)[0] : dayjs.unix(detail.created_at).format(t('appLog.dateTimeFormat') as string)}</div>
      </div>
      <div className='flex items-center'>
        <div
          className={cn('mr-2 flex items-center border h-8 px-2 space-x-2 rounded-lg bg-indigo-25 border-[#2A87F5]')}
        >
          <ModelIcon
            className='!w-5 !h-5'
            modelId={modelName}
            providerName={provideName}
          />
          <div className='text-[13px] text-gray-900 font-medium'>
            <ModelName modelId={modelName} modelDisplayName={modelName} />
          </div>
          <ModelModeTypeLabel type={ModelModeType.chat} isHighlight />
        </div>
        <Popover
          position='br'
          className='!w-[280px]'
          btnClassName='mr-4 !bg-gray-50 !py-1.5 !px-2.5 border-none font-normal'
          btnElement={<>
            <span className='text-[13px]'>{targetTone}</span>
            <InformationCircleIcon className='h-4 w-4 text-gray-800 ml-1.5' />
          </>}
          htmlContent={<div className='w-[280px]'>
            <div className='flex justify-between py-2 px-4 font-medium text-sm text-gray-700'>
              <span>Tone of responses</span>
              <div>{targetTone}</div>
            </div>
            {['temperature', 'top_p', 'presence_penalty', 'max_tokens'].map((param: string, index: number) => {
              return <div className='flex justify-between py-2 px-4 bg-gray-50' key={index}>
                <span className='text-xs text-gray-700'>{PARAM_MAP[param as keyof typeof PARAM_MAP]}</span>
                <span className='text-gray-800 font-medium text-xs'>{detail?.model_config.model?.completion_params?.[param] || '-'}</span>
              </div>
            })}
          </div>}
        />
        <div className='w-6 h-6 rounded-lg flex items-center justify-center hover:cursor-pointer hover:bg-gray-100'>
          <XMarkIcon className='w-4 h-4 text-gray-500' onClick={onClose} />
        </div>
      </div>

    </div>
    {/* Panel Body */}
    {varList.length > 0 && (
      <div className='px-6 pt-4 pb-2'>
        <VarPanel varList={varList} />
      </div>
    )}
    {!isChatMode
      ? <div className="px-2.5 py-4">
        <Chat
          chatList={getFormattedChatList([detail.message])}
          isHideSendInput={true}
          onFeedback={onFeedback}
          onSubmitAnnotation={onSubmitAnnotation}
          displayScene='console'
          isShowPromptLog
        />
      </div>
      : items.length < 8
        ? <div className="px-2.5 pt-4 mb-4">
          <Chat
            chatList={items}
            isHideSendInput={true}
            onFeedback={onFeedback}
            onSubmitAnnotation={onSubmitAnnotation}
            displayScene='console'
            isShowPromptLog
          />
        </div>
        : <div
          className="px-2.5 py-4"
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
              chatList={items}
              isHideSendInput={true}
              onFeedback={onFeedback}
              onSubmitAnnotation={onSubmitAnnotation}
              displayScene='console'
              isShowPromptLog
            />
          </InfiniteScroll>
        </div>
    }
  </div>)
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
  const [showDrawer, setShowDrawer] = useState<boolean>(false) // Whether to display the chat details drawer
  const [currentConversation, setCurrentConversation] = useState<ChatConversationGeneralDetail | CompletionConversationGeneralDetail | undefined>() // Currently selected conversation
  const isChatMode = appDetail?.mode === 'chat' // Whether the app is a chat app

  // Annotated data needs to be highlighted
  const renderTdValue = (value: string | number | null, isEmptyStyle: boolean, isHighlight = false, annotation?: Annotation) => {
    return (
      <Tooltip
        htmlContent={
          <span className='text-xs text-gray-500 inline-flex items-center'>
            <EditIconSolid className='mr-1' />{`${t('appLog.detail.annotationTip', { user: annotation?.account?.name })} ${dayjs.unix(annotation?.created_at || dayjs().unix()).format('MM-DD hh:mm A')}`}
          </span>
        }
        className={(isHighlight && !isChatMode) ? '' : '!hidden'}
        selector={`highlight-${randomString(16)}`}
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
    <>
      <table className={`w-full border-collapse border-0 text-sm mt-3 ${s.logTable}`}>
        <thead className="h-8 leading-8 border-b  border-gray-200 text-gray-500 font-bold">
          <tr>
            <td className='w-[1.375rem]'></td>
            <td>{t('appLog.table.header.time')}</td>
            <td>{t('appLog.table.header.endUser')}</td>
            <td>{isChatMode ? t('appLog.table.header.summary') : t('appLog.table.header.input')}</td>
            <td>{isChatMode ? t('appLog.table.header.messageCount') : t('appLog.table.header.output')}</td>
            <td>{t('appLog.table.header.userRate')}</td>
            <td>{t('appLog.table.header.adminRate')}</td>
          </tr>
        </thead>
        <tbody className="text-gray-500">
          {logs.data.map((log: any) => {
            const endUser = log.from_end_user_session_id
            const leftValue = get(log, isChatMode ? 'summary' : 'message.inputs.query') || (!isChatMode ? (get(log, 'message.query') || get(log, 'message.inputs.default_input')) : '') || ''
            const rightValue = get(log, isChatMode ? 'message_count' : 'message.answer')
            return <tr
              key={log.id}
              className={`border-b border-gray-200 h-8 hover:bg-gray-50 cursor-pointer ${currentConversation?.id !== log.id ? '' : 'bg-gray-50'}`}
              onClick={() => {
                setShowDrawer(true)
                setCurrentConversation(log)
              }}>
              <td className='text-center align-middle'>{!log.read_at && <span className='inline-block bg-[#3F83F8] h-1.5 w-1.5 rounded'></span>}</td>
              <td className='w-[160px]'>{dayjs.unix(log.created_at).format(t('appLog.dateTimeFormat') as string)}</td>
              <td>{renderTdValue(endUser || defaultValue, !endUser)}</td>
              <td style={{ maxWidth: isChatMode ? 300 : 200 }}>
                {renderTdValue(leftValue || t('appLog.table.empty.noChat'), !leftValue, isChatMode && log.annotated)}
              </td>
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
            </tr>
          })}
        </tbody>
      </table>
      <Drawer
        isOpen={showDrawer}
        onClose={onCloseDrawer}
        mask={false}
        footer={null}
        panelClassname='mt-16 mr-2 mb-3 !p-0 !max-w-[640px] rounded-b-xl'
      >
        <DrawerContext.Provider value={{
          onClose: onCloseDrawer,
          appDetail,
        }}>
          {isChatMode
            ? <ChatConversationDetailComp appId={appDetail?.id} conversationId={currentConversation?.id} />
            : <CompletionConversationDetailComp appId={appDetail?.id} conversationId={currentConversation?.id} />
          }
        </DrawerContext.Provider>
      </Drawer>
    </>
  )
}

export default ConversationList
