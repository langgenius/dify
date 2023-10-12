'use client'
import type { FC } from 'react'
import React, { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useContext } from 'use-context-selector'
import cn from 'classnames'
import Recorder from 'js-audio-recorder'
import { useTranslation } from 'react-i18next'
import s from './style.module.css'
import type { DisplayScene, FeedbackFunc, IChatItem, SubmitAnnotationFunc } from './type'
import { TryToAskIcon, stopIcon } from './icon-component'
import Answer from './answer'
import Question from './question'
import Tooltip from '@/app/components/base/tooltip'
import { ToastContext } from '@/app/components/base/toast'
import AutoHeightTextarea from '@/app/components/base/auto-height-textarea'
import Button from '@/app/components/base/button'
import useBreakpoints, { MediaType } from '@/hooks/use-breakpoints'
import VoiceInput from '@/app/components/base/voice-input'
import { Microphone01 } from '@/app/components/base/icons/src/vender/line/mediaAndDevices'
import { Microphone01 as Microphone01Solid } from '@/app/components/base/icons/src/vender/solid/mediaAndDevices'
import { XCircle } from '@/app/components/base/icons/src/vender/solid/general'
import type { DataSet } from '@/models/datasets'

export type IChatProps = {
  configElem?: React.ReactNode
  chatList: IChatItem[]
  controlChatUpdateAllConversation?: number
  /**
   * Whether to display the editing area and rating status
   */
  feedbackDisabled?: boolean
  /**
   * Whether to display the input area
   */
  isHideFeedbackEdit?: boolean
  isHideSendInput?: boolean
  onFeedback?: FeedbackFunc
  onSubmitAnnotation?: SubmitAnnotationFunc
  checkCanSend?: () => boolean
  onSend?: (message: string) => void
  displayScene?: DisplayScene
  useCurrentUserAvatar?: boolean
  isResponsing?: boolean
  canStopResponsing?: boolean
  abortResponsing?: () => void
  controlClearQuery?: number
  controlFocus?: number
  isShowSuggestion?: boolean
  suggestionList?: string[]
  isShowSpeechToText?: boolean
  isShowCitation?: boolean
  answerIconClassName?: string
  isShowConfigElem?: boolean
  dataSets?: DataSet[]
  isShowCitationHitInfo?: boolean
  isShowPromptLog?: boolean
}

const Chat: FC<IChatProps> = ({
  configElem,
  chatList,

  feedbackDisabled = false,
  isHideFeedbackEdit = false,
  isHideSendInput = false,
  onFeedback,
  onSubmitAnnotation,
  checkCanSend,
  onSend = () => { },
  displayScene,
  useCurrentUserAvatar,
  isResponsing,
  canStopResponsing,
  abortResponsing,
  controlClearQuery,
  controlFocus,
  isShowSuggestion,
  suggestionList,
  isShowSpeechToText,
  isShowCitation,
  answerIconClassName,
  isShowConfigElem,
  dataSets,
  isShowCitationHitInfo,
  isShowPromptLog,
}) => {
  const { t } = useTranslation()
  const { notify } = useContext(ToastContext)
  const isUseInputMethod = useRef(false)

  const [query, setQuery] = React.useState('')
  const handleContentChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value
    setQuery(value)
  }

  const logError = (message: string) => {
    notify({ type: 'error', message, duration: 3000 })
  }

  const valid = () => {
    if (!query || query.trim() === '') {
      logError('Message cannot be empty')
      return false
    }
    return true
  }

  useEffect(() => {
    if (controlClearQuery)
      setQuery('')
  }, [controlClearQuery])

  const handleSend = () => {
    if (!valid() || (checkCanSend && !checkCanSend()))
      return
    onSend(query)
    if (!isResponsing)
      setQuery('')
  }

  const handleKeyUp = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.code === 'Enter') {
      e.preventDefault()
      // prevent send message when using input method enter
      if (!e.shiftKey && !isUseInputMethod.current)
        handleSend()
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    isUseInputMethod.current = e.nativeEvent.isComposing
    if (e.code === 'Enter' && !e.shiftKey) {
      setQuery(query.replace(/\n$/, ''))
      e.preventDefault()
    }
  }

  const media = useBreakpoints()
  const isMobile = media === MediaType.mobile
  const sendBtn = <div className={cn(!(!query || query.trim() === '') && s.sendBtnActive, `${s.sendBtn} w-8 h-8 cursor-pointer rounded-md`)} onClick={handleSend}></div>

  const suggestionListRef = useRef<HTMLDivElement>(null)
  const [hasScrollbar, setHasScrollbar] = useState(false)
  useLayoutEffect(() => {
    if (suggestionListRef.current) {
      const listDom = suggestionListRef.current
      const hasScrollbar = listDom.scrollWidth > listDom.clientWidth
      setHasScrollbar(hasScrollbar)
    }
  }, [suggestionList])

  const [voiceInputShow, setVoiceInputShow] = useState(false)
  const handleVoiceInputShow = () => {
    (Recorder as any).getPermission().then(() => {
      setVoiceInputShow(true)
    }, () => {
      logError(t('common.voiceInput.notAllow'))
    })
  }

  return (
    <div className={cn('px-3.5', 'h-full')}>
      {isShowConfigElem && (configElem || null)}
      {/* Chat List */}
      <div className={cn((isShowConfigElem && configElem) ? 'h-0' : 'h-full', 'space-y-[30px]')}>
        {chatList.map((item) => {
          if (item.isAnswer) {
            const isLast = item.id === chatList[chatList.length - 1].id
            const thoughts = item.agent_thoughts?.filter(item => item.thought !== '[DONE]')
            const citation = item.citation
            const isThinking = !item.content && item.agent_thoughts && item.agent_thoughts?.length > 0 && !item.agent_thoughts.some(item => item.thought === '[DONE]')
            return <Answer
              key={item.id}
              item={item}
              feedbackDisabled={feedbackDisabled}
              isHideFeedbackEdit={isHideFeedbackEdit}
              onFeedback={onFeedback}
              onSubmitAnnotation={onSubmitAnnotation}
              displayScene={displayScene ?? 'web'}
              isResponsing={isResponsing && isLast}
              answerIconClassName={answerIconClassName}
              thoughts={thoughts}
              citation={citation}
              isThinking={isThinking}
              dataSets={dataSets}
              isShowCitation={isShowCitation}
              isShowCitationHitInfo={isShowCitationHitInfo}
            />
          }
          return (
            <Question
              key={item.id}
              id={item.id}
              content={item.content}
              more={item.more}
              useCurrentUserAvatar={useCurrentUserAvatar}
              item={item}
              isShowPromptLog={isShowPromptLog}
            />
          )
        })}
      </div>
      {
        !isHideSendInput && (
          <div className={cn(!feedbackDisabled && '!left-3.5 !right-3.5', 'absolute z-10 bottom-0 left-0 right-0')}>
            {/* Thinking is sync and can not be stopped */}
            {(isResponsing && canStopResponsing && !!chatList[chatList.length - 1]?.content) && (
              <div className='flex justify-center mb-4'>
                <Button className='flex items-center space-x-1 bg-white' onClick={() => abortResponsing?.()}>
                  {stopIcon}
                  <span className='text-xs text-gray-500 font-normal'>{t('appDebug.operation.stopResponding')}</span>
                </Button>
              </div>
            )}
            {
              isShowSuggestion && (
                <div className='pt-2'>
                  <div className='flex items-center justify-center mb-2.5'>
                    <div className='grow h-[1px]'
                      style={{
                        background: 'linear-gradient(270deg, #F3F4F6 0%, rgba(243, 244, 246, 0) 100%)',
                      }}></div>
                    <div className='shrink-0 flex items-center px-3 space-x-1'>
                      {TryToAskIcon}
                      <span className='text-xs text-gray-500 font-medium'>{t('appDebug.feature.suggestedQuestionsAfterAnswer.tryToAsk')}</span>
                    </div>
                    <div className='grow h-[1px]'
                      style={{
                        background: 'linear-gradient(270deg, rgba(243, 244, 246, 0) 0%, #F3F4F6 100%)',
                      }}></div>
                  </div>
                  {/* has scrollbar would hide part of first item */}
                  <div ref={suggestionListRef} className={cn(!hasScrollbar && 'justify-center', 'flex overflow-x-auto pb-2')}>
                    {suggestionList?.map((item, index) => (
                      <div key={item} className='shrink-0 flex justify-center mr-2'>
                        <Button
                          key={index}
                          onClick={() => setQuery(item)}
                        >
                          <span className='text-primary-600 text-xs font-medium'>{item}</span>
                        </Button>
                      </div>
                    ))}
                  </div>
                </div>)
            }
            <div className="relative">
              <AutoHeightTextarea
                value={query}
                onChange={handleContentChange}
                onKeyUp={handleKeyUp}
                onKeyDown={handleKeyDown}
                minHeight={48}
                autoFocus
                controlFocus={controlFocus}
                className={`${cn(s.textArea)} resize-none block w-full pl-3 bg-gray-50 border border-gray-200 rounded-md  focus:outline-none sm:text-sm text-gray-700`}
              />
              <div className="absolute top-0 right-2 flex items-center h-[48px]">
                <div className={`${s.count} mr-4 h-5 leading-5 text-sm bg-gray-50 text-gray-500`}>{query.trim().length}</div>
                {
                  query
                    ? (
                      <div className='flex justify-center items-center w-8 h-8 cursor-pointer hover:bg-gray-100 rounded-lg' onClick={() => setQuery('')}>
                        <XCircle className='w-4 h-4 text-[#98A2B3]' />
                      </div>
                    )
                    : isShowSpeechToText
                      ? (
                        <div
                          className='group flex justify-center items-center w-8 h-8 hover:bg-primary-50 rounded-lg cursor-pointer'
                          onClick={handleVoiceInputShow}
                        >
                          <Microphone01 className='block w-4 h-4 text-gray-500 group-hover:hidden' />
                          <Microphone01Solid className='hidden w-4 h-4 text-primary-600 group-hover:block' />
                        </div>
                      )
                      : null
                }
                <div className='mx-2 w-[1px] h-4 bg-black opacity-5' />
                {isMobile
                  ? sendBtn
                  : (
                    <Tooltip
                      selector='send-tip'
                      htmlContent={
                        <div>
                          <div>{t('common.operation.send')} Enter</div>
                          <div>{t('common.operation.lineBreak')} Shift Enter</div>
                        </div>
                      }
                    >
                      {sendBtn}
                    </Tooltip>
                  )}
              </div>
              {
                voiceInputShow && (
                  <VoiceInput
                    onCancel={() => setVoiceInputShow(false)}
                    onConverted={text => setQuery(text)}
                  />
                )
              }
            </div>
          </div>
        )
      }

    </div>
  )
}
export default React.memo(Chat)
