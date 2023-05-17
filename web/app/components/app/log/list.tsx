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
import { SparklesIcon } from '@heroicons/react/24/solid'
import { get } from 'lodash-es'
import InfiniteScroll from 'react-infinite-scroll-component'
import dayjs from 'dayjs'
import { createContext, useContext } from 'use-context-selector'
import classNames from 'classnames'
import { useTranslation } from 'react-i18next'
import { EditIconSolid } from '../chat'
import { randomString } from '../../app-sidebar/basic'
import s from './style.module.css'
import type { FeedbackFunc, Feedbacktype, IChatItem, SubmitAnnotationFunc } from '@/app/components/app/chat'
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

export const OpenAIIcon: FC<{ className?: string }> = ({ className }) => {
  return <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" className={className ?? ''}>
    <rect width="16" height="16" rx="6" fill="black" />
    <path d="M13.6553 7.70613C13.7853 7.99625 13.8678 8.30638 13.9016 8.62276C13.9341 8.93913 13.9179 9.25927 13.8503 9.57064C13.7841 9.88202 13.669 10.1809 13.5089 10.456C13.4039 10.6398 13.2801 10.8124 13.1375 10.9712C12.9962 11.1288 12.8387 11.2713 12.6673 11.3964C12.4948 11.5214 12.311 11.6265 12.1159 11.7128C11.922 11.7978 11.7195 11.8628 11.5119 11.9053C11.4143 12.208 11.2693 12.4943 11.0817 12.7519C10.8954 13.0095 10.669 13.2359 10.4114 13.4222C10.1538 13.6098 9.86871 13.7549 9.56608 13.8524C9.26346 13.9512 8.94708 14 8.6282 14C8.41686 14.0012 8.20428 13.9787 7.99669 13.9362C7.79036 13.8924 7.58778 13.8261 7.39395 13.7398C7.20012 13.6536 7.01629 13.546 6.84497 13.421C6.6749 13.2959 6.51734 13.1521 6.37728 12.9933C6.06465 13.0608 5.74452 13.0771 5.42814 13.0446C5.11177 13.0108 4.80164 12.9283 4.51027 12.7982C4.22015 12.6694 3.95129 12.4943 3.71495 12.2805C3.4786 12.0667 3.27727 11.8166 3.11845 11.5414C3.01216 11.3576 2.92462 11.1638 2.85835 10.9625C2.79207 10.7611 2.7483 10.5535 2.72579 10.3422C2.70328 10.1321 2.70453 9.91954 2.72704 9.7082C2.74955 9.49811 2.79582 9.29053 2.8621 9.0892C2.64951 8.85285 2.47444 8.58399 2.34439 8.29387C2.21558 8.0025 2.1318 7.69363 2.09929 7.37725C2.06552 7.06087 2.08303 6.74074 2.14931 6.42936C2.21558 6.11798 2.33063 5.81911 2.4907 5.544C2.59574 5.36017 2.71954 5.18635 2.86085 5.02879C3.00215 4.87122 3.16097 4.72867 3.33229 4.60361C3.50361 4.47856 3.68868 4.37227 3.88251 4.28724C4.07759 4.20095 4.28018 4.13717 4.48776 4.09466C4.5853 3.79078 4.73036 3.50567 4.91669 3.24806C5.10426 2.99046 5.33061 2.76411 5.58821 2.57654C5.84582 2.39021 6.13093 2.24515 6.43356 2.14636C6.73618 2.04882 7.05256 1.9988 7.37144 2.00005C7.58277 1.9988 7.79536 2.02006 8.00295 2.06383C8.21053 2.1076 8.41311 2.17262 8.60694 2.25891C8.80077 2.34644 8.9846 2.45274 9.15592 2.57779C9.32724 2.70409 9.4848 2.84665 9.62486 3.00546C9.93623 2.93919 10.2564 2.92293 10.5727 2.95544C10.8891 2.98796 11.198 3.07174 11.4894 3.20054C11.7795 3.3306 12.0483 3.50442 12.2847 3.71825C12.521 3.93084 12.7224 4.17969 12.8812 4.45605C12.9875 4.63863 13.075 4.83246 13.1413 5.03504C13.2076 5.23637 13.2526 5.44396 13.2738 5.65529C13.2964 5.86663 13.2964 6.07922 13.2726 6.29055C13.2501 6.50189 13.2038 6.70948 13.1375 6.91081C13.3514 7.14715 13.5252 7.41476 13.6553 7.70613ZM9.48855 13.0446C9.76116 12.932 10.0088 12.7657 10.2176 12.5569C10.4264 12.348 10.5928 12.1004 10.7053 11.8266C10.8178 11.554 10.8766 11.2613 10.8766 10.9662V8.17757C10.8758 8.17507 10.875 8.17215 10.8741 8.16882C10.8733 8.16632 10.872 8.16382 10.8704 8.16132C10.8687 8.15882 10.8666 8.15673 10.8641 8.15507C10.8616 8.15256 10.8591 8.1509 10.8566 8.15006L9.84745 7.56733V10.9362C9.84745 10.97 9.84245 11.005 9.83369 11.0375C9.82494 11.0713 9.81243 11.1025 9.79493 11.1325C9.77742 11.1625 9.75741 11.1901 9.7324 11.2138C9.70809 11.238 9.68077 11.2591 9.65112 11.2763L7.26139 12.6557C7.24138 12.6682 7.20762 12.6857 7.19011 12.6957C7.2889 12.7795 7.39645 12.8532 7.50899 12.9183C7.62279 12.9833 7.74034 13.0383 7.86289 13.0833C7.98544 13.1271 8.11174 13.1609 8.23929 13.1834C8.36809 13.2059 8.49815 13.2171 8.6282 13.2171C8.92332 13.2171 9.21594 13.1584 9.48855 13.0446ZM3.79748 11.1513C3.94629 11.4076 4.14262 11.6302 4.37647 11.8103C4.61156 11.9904 4.87792 12.1217 5.16304 12.198C5.44815 12.2742 5.74577 12.2943 6.03839 12.2555C6.33101 12.2167 6.61238 12.1217 6.86873 11.9741L9.28472 10.5798L9.29097 10.5736C9.29264 10.5719 9.29389 10.5694 9.29472 10.566C9.29639 10.5635 9.29764 10.561 9.29847 10.5585V9.38307L6.38228 11.07C6.35227 11.0875 6.32101 11.1 6.2885 11.11C6.25473 11.1188 6.22097 11.1225 6.18595 11.1225C6.15219 11.1225 6.11843 11.1188 6.08466 11.11C6.05215 11.1 6.01964 11.0875 5.98962 11.07L3.5999 9.68944C3.57864 9.67694 3.54738 9.65818 3.52987 9.64692C3.50736 9.77573 3.49611 9.90578 3.49611 10.0358C3.49611 10.1659 3.50861 10.2959 3.53112 10.4247C3.55363 10.5523 3.58864 10.6786 3.63241 10.8011C3.67743 10.9237 3.73245 11.0412 3.79748 11.1538V11.1513ZM3.16972 5.93666C3.02216 6.19301 2.92712 6.47563 2.88836 6.76825C2.84959 7.06087 2.8696 7.35724 2.94588 7.64361C3.02216 7.92872 3.15347 8.19508 3.33354 8.43018C3.51361 8.66402 3.73745 8.86035 3.99256 9.00791L6.40729 10.4035C6.4098 10.4043 6.41271 10.4051 6.41605 10.406H6.4248C6.42814 10.406 6.43105 10.4051 6.43356 10.4035C6.43606 10.4026 6.43856 10.4014 6.44106 10.3997L7.45397 9.81449L4.53778 8.13131C4.50902 8.1138 4.48151 8.09254 4.4565 8.06878C4.43227 8.04447 4.41125 8.01715 4.39397 7.9875C4.37772 7.95748 4.36396 7.92622 4.35521 7.89246C4.34645 7.85994 4.34145 7.82618 4.3427 7.79117V4.95126C4.22015 4.99628 4.10135 5.0513 3.98881 5.11632C3.87626 5.1826 3.76997 5.25763 3.66993 5.34142C3.57114 5.4252 3.4786 5.51774 3.39481 5.61778C3.31103 5.71657 3.23725 5.82411 3.17222 5.93666H3.16972ZM11.4644 7.86745C11.4944 7.88495 11.5219 7.90496 11.5469 7.92997C11.5707 7.95373 11.5919 7.98124 11.6094 8.01126C11.6257 8.04127 11.6394 8.07378 11.6482 8.10629C11.6557 8.14006 11.6607 8.17382 11.6594 8.20884V11.0487C12.0609 10.9012 12.411 10.6423 12.6699 10.3022C12.93 9.96205 13.0863 9.55564 13.1225 9.13046C13.1588 8.70529 13.0738 8.27762 12.8762 7.89871C12.6786 7.51981 12.3772 7.20468 12.0071 6.99209L9.59234 5.59652C9.58984 5.59569 9.58693 5.59485 9.58359 5.59402H9.57484C9.57234 5.59485 9.56942 5.59569 9.56608 5.59652C9.56358 5.59735 9.56108 5.5986 9.55858 5.60027L8.55067 6.18301L11.4669 7.86745H11.4644ZM12.471 6.35433H12.4698V6.35558L12.471 6.35433ZM12.4698 6.35308C12.5423 5.93291 12.4935 5.50023 12.3285 5.10632C12.1646 4.71241 11.8908 4.37352 11.5406 4.12842C11.1905 3.88457 10.7778 3.74451 10.3514 3.72576C9.92373 3.70825 9.50106 3.81204 9.13091 4.02463L6.71617 5.41895C6.71367 5.42062 6.71159 5.4227 6.70992 5.4252L6.70492 5.4327C6.70408 5.4352 6.70325 5.43812 6.70241 5.44146C6.70158 5.44396 6.70116 5.44688 6.70116 5.45021V6.61569L9.61735 4.93125C9.64737 4.91374 9.67988 4.90124 9.71239 4.89123C9.74616 4.88248 9.77992 4.87873 9.81368 4.87873C9.8487 4.87873 9.88246 4.88248 9.91623 4.89123C9.94874 4.90124 9.98 4.91374 10.01 4.93125L12.3997 6.31181C12.421 6.32432 12.4523 6.34182 12.4698 6.35308ZM6.15094 5.06255C6.15094 5.02879 6.15594 4.99502 6.1647 4.96126C6.17345 4.92875 6.18595 4.89623 6.20346 4.86622C6.22097 4.83746 6.24098 4.80995 6.26599 4.78494C6.28975 4.76118 6.31726 4.73992 6.34727 4.72366L8.73699 3.34435C8.7595 3.3306 8.79077 3.31309 8.80827 3.30433C8.48064 3.03047 8.08048 2.8554 7.65655 2.80163C7.23263 2.74661 6.80246 2.81413 6.41605 2.99546C6.02839 3.17678 5.70076 3.46565 5.47191 3.8258C5.24307 4.18719 5.12177 4.60487 5.12177 5.03254V7.82118C5.1226 7.82451 5.12344 7.82743 5.12427 7.82993C5.1251 7.83243 5.12635 7.83493 5.12802 7.83744C5.12969 7.83994 5.13177 7.84244 5.13427 7.84494C5.13594 7.84661 5.13844 7.84827 5.14178 7.84994L6.15094 8.43268V5.06255ZM6.69866 8.74781L7.99794 9.49811L9.29722 8.74781V7.24845L7.99919 6.49814L6.69991 7.24845L6.69866 8.74781Z" fill="white" />
  </svg>
}

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
      content: item.query,
      isAnswer: false,
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
  detail: T
  onFeedback: FeedbackFunc
  onSubmitAnnotation: SubmitAnnotationFunc
}

function DetailPanel<T extends ChatConversationFullDetailResponse | CompletionConversationFullDetailResponse>({ detail, onFeedback, onSubmitAnnotation }: IDetailPanel<T>) {
  const { onClose, appDetail } = useContext(DrawerContext)
  const { t } = useTranslation()
  const [items, setItems] = React.useState<IChatItem[]>([])
  const [hasMore, setHasMore] = useState(true)

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

  const targetTone = TONE_LIST.find((item) => {
    let res = true
    validatedParams.forEach((param) => {
      res = item.config?.[param] === detail.model_config?.configs?.completion_params?.[param]
    })
    return res
  })?.name ?? 'custom'

  return (<div className='rounded-xl border-[0.5px] border-gray-200 h-full flex flex-col overflow-auto'>
    {/* Panel Header */}
    <div className='border-b border-gray-100 py-4 px-6 flex items-center justify-between'>
      <div className='flex-1'>
        <span className='text-gray-500 text-[10px]'>{isChatMode ? t('appLog.detail.conversationId') : t('appLog.detail.time')}</span>
        <div className='text-gray-800 text-sm'>{isChatMode ? detail.id : dayjs.unix(detail.created_at).format(t('appLog.dateTimeFormat'))}</div>
      </div>
      <div className='mr-2 bg-gray-50 py-1.5 px-2.5 rounded-lg flex items-center text-[13px]'><OpenAIIcon className='mr-2' />{detail.model_config.model_id}</div>
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
          {['temperature', 'top_p', 'presence_penalty', 'max_tokens'].map((param, index) => {
            return <div className='flex justify-between py-2 px-4 bg-gray-50' key={index}>
              <span className='text-xs text-gray-700'>{PARAM_MAP[param]}</span>
              <span className='text-gray-800 font-medium text-xs'>{detail?.model_config.model?.completion_params?.[param] || '-'}</span>
            </div>
          })}
        </div>}
      />
      <div className='w-6 h-6 rounded-lg flex items-center justify-center hover:cursor-pointer hover:bg-gray-100'>
        <XMarkIcon className='w-4 h-4 text-gray-500' onClick={onClose} />
      </div>
    </div>
    {/* Panel Body */}
    <div className='bg-gray-50 border border-gray-100 px-4 py-3 mx-6 my-4 rounded-lg'>
      <div className='text-gray-500 text-xs flex items-center'>
        <SparklesIcon className='h-3 w-3 mr-1' />{isChatMode ? t('appLog.detail.promptTemplateBeforeChat') : t('appLog.detail.promptTemplate')}
      </div>
      <div className='text-gray-700 font-medium text-sm mt-2'>{detail.model_config?.pre_prompt || emptyText}</div>
    </div>
    {!isChatMode
      ? <div className="px-2.5 py-4">
        <Chat
          chatList={getFormattedChatList([detail.message])}
          isHideSendInput={true}
          onFeedback={onFeedback}
          onSubmitAnnotation={onSubmitAnnotation}
          displayScene='console'
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
      notify({ type: 'error', message: t('common.actionMsg.modificationFailed') })
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
      notify({ type: 'error', message: t('common.actionMsg.modificationFailed') })
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
      notify({ type: 'error', message: t('common.actionMsg.modificationFailed') })
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
      notify({ type: 'error', message: t('common.actionMsg.modificationFailed') })
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
        <div className={classNames(isEmptyStyle ? 'text-gray-400' : 'text-gray-700', !isHighlight ? '' : 'bg-orange-100', 'text-sm overflow-hidden text-ellipsis whitespace-nowrap')}>
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
          {logs.data.map((log) => {
            const endUser = log.from_end_user_id?.slice(0, 8)
            const leftValue = get(log, isChatMode ? 'summary' : 'message.query')
            const rightValue = get(log, isChatMode ? 'message_count' : 'message.answer')
            return <tr
              key={log.id}
              className={`border-b border-gray-200 h-8 hover:bg-gray-50 cursor-pointer ${currentConversation?.id !== log.id ? '' : 'bg-gray-50'}`}
              onClick={() => {
                setShowDrawer(true)
                setCurrentConversation(log)
              }}>
              <td className='text-center align-middle'>{!log.read_at && <span className='inline-block bg-[#3F83F8] h-1.5 w-1.5 rounded'></span>}</td>
              <td className='w-[160px]'>{dayjs.unix(log.created_at).format(t('appLog.dateTimeFormat'))}</td>
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
