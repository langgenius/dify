'use client'
import type { FC, ReactNode } from 'react'
import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import Textarea from 'rc-textarea'
import { useContext } from 'use-context-selector'
import cn from 'classnames'
import Recorder from 'js-audio-recorder'
import { useTranslation } from 'react-i18next'
import s from './style.module.css'
import type { DisplayScene, FeedbackFunc, IChatItem } from './type'
import { TryToAskIcon, stopIcon } from './icon-component'
import Answer from './answer'
import Question from './question'
import TooltipPlus from '@/app/components/base/tooltip-plus'
import { ToastContext } from '@/app/components/base/toast'
import Button from '@/app/components/base/button'
import useBreakpoints, { MediaType } from '@/hooks/use-breakpoints'
import VoiceInput from '@/app/components/base/voice-input'
import { Microphone01 } from '@/app/components/base/icons/src/vender/line/mediaAndDevices'
import { Microphone01 as Microphone01Solid } from '@/app/components/base/icons/src/vender/solid/mediaAndDevices'
import { XCircle } from '@/app/components/base/icons/src/vender/solid/general'
import type { DataSet } from '@/models/datasets'
import ChatImageUploader from '@/app/components/base/image-uploader/chat-image-uploader'
import ImageList from '@/app/components/base/image-uploader/image-list'
import { TransferMethod, type VisionFile, type VisionSettings } from '@/types/app'
import { useClipboardUploader, useDraggableUploader, useImageFiles } from '@/app/components/base/image-uploader/hooks'
import type { Annotation } from '@/models/log'
import type { Emoji } from '@/app/components/tools/types'

export type IChatProps = {
  appId?: string
  configElem?: React.ReactNode
  chatList: IChatItem[]
  onChatListChange?: (chatList: IChatItem[]) => void
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
  checkCanSend?: () => boolean
  query?: string
  onQueryChange?: (query: string) => void
  onSend?: (message: string, files: VisionFile[]) => void
  displayScene?: DisplayScene
  useCurrentUserAvatar?: boolean
  isResponding?: boolean
  canStopResponding?: boolean
  abortResponding?: () => void
  controlClearQuery?: number
  controlFocus?: number
  isShowSuggestion?: boolean
  suggestionList?: string[]
  isShowSpeechToText?: boolean
  isShowTextToSpeech?: boolean
  isShowCitation?: boolean
  answerIcon?: ReactNode
  isShowConfigElem?: boolean
  dataSets?: DataSet[]
  isShowCitationHitInfo?: boolean
  isShowPromptLog?: boolean
  visionConfig?: VisionSettings
  supportAnnotation?: boolean
  allToolIcons?: Record<string, string | Emoji>
}

const Chat: FC<IChatProps> = ({
  configElem,
  chatList,
  query = '',
  onQueryChange = () => { },
  feedbackDisabled = false,
  isHideFeedbackEdit = false,
  isHideSendInput = false,
  onFeedback,
  checkCanSend,
  onSend = () => { },
  displayScene,
  useCurrentUserAvatar,
  isResponding,
  canStopResponding,
  abortResponding,
  controlClearQuery,
  controlFocus,
  isShowSuggestion,
  suggestionList,
  isShowSpeechToText,
  isShowTextToSpeech,
  isShowCitation,
  answerIcon,
  isShowConfigElem,
  dataSets,
  isShowCitationHitInfo,
  isShowPromptLog,
  visionConfig,
  appId,
  supportAnnotation,
  onChatListChange,
  allToolIcons,
}) => {
  const { t } = useTranslation()
  const { notify } = useContext(ToastContext)
  const {
    files,
    onUpload,
    onRemove,
    onReUpload,
    onImageLinkLoadError,
    onImageLinkLoadSuccess,
    onClear,
  } = useImageFiles()
  const { onPaste } = useClipboardUploader({ onUpload, visionConfig, files })
  const { onDragEnter, onDragLeave, onDragOver, onDrop, isDragActive } = useDraggableUploader<HTMLTextAreaElement>({ onUpload, files, visionConfig })
  const isUseInputMethod = useRef(false)

  const handleContentChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value
    onQueryChange(value)
  }

  const logError = (message: string) => {
    notify({ type: 'error', message, duration: 3000 })
  }

  const valid = (q?: string) => {
    const sendQuery = q || query
    if (!sendQuery || sendQuery.trim() === '') {
      logError('Message cannot be empty')
      return false
    }
    return true
  }

  useEffect(() => {
    if (controlClearQuery)
      onQueryChange('')
  }, [controlClearQuery])

  const handleSend = (q?: string) => {
    if (!valid(q) || (checkCanSend && !checkCanSend()))
      return
    onSend(q || query, files.filter(file => file.progress !== -1).map(fileItem => ({
      type: 'image',
      transfer_method: fileItem.type,
      url: fileItem.url,
      upload_file_id: fileItem.fileId,
    })))
    if (!files.find(item => item.type === TransferMethod.local_file && !item.fileId)) {
      if (files.length)
        onClear()
      if (!isResponding)
        onQueryChange('')
    }
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
      onQueryChange(query.replace(/\n$/, ''))
      e.preventDefault()
    }
  }

  const media = useBreakpoints()
  const isMobile = media === MediaType.mobile
  const sendBtn = <div className={cn(!(!query || query.trim() === '') && s.sendBtnActive, `${s.sendBtn} w-8 h-8 cursor-pointer rounded-md`)} onClick={() => handleSend()}></div>

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
  const handleQueryChangeFromAnswer = useCallback((val: string) => {
    onQueryChange(val)
    handleSend(val)
  }, [])
  const handleAnnotationEdited = useCallback((query: string, answer: string, index: number) => {
    onChatListChange?.(chatList.map((item, i) => {
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
  }, [chatList])
  const handleAnnotationAdded = useCallback((annotationId: string, authorName: string, query: string, answer: string, index: number) => {
    onChatListChange?.(chatList.map((item, i) => {
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
  }, [chatList])
  const handleAnnotationRemoved = useCallback((index: number) => {
    onChatListChange?.(chatList.map((item, i) => {
      if (i === index) {
        return {
          ...item,
          content: item.content,
          annotation: undefined,
        }
      }
      return item
    }))
  }, [chatList])

  return (
    <div className={cn('px-3.5', 'h-full')}>
      {isShowConfigElem && (configElem || null)}
      {/* Chat List */}
      <div className={cn((isShowConfigElem && configElem) ? 'h-0' : 'h-full', 'space-y-[30px]')}>
        {chatList.map((item, index) => {
          if (item.isAnswer) {
            const isLast = item.id === chatList[chatList.length - 1].id
            const citation = item.citation
            return <Answer
              key={item.id}
              item={item}
              index={index}
              onQueryChange={handleQueryChangeFromAnswer}
              feedbackDisabled={feedbackDisabled}
              isHideFeedbackEdit={isHideFeedbackEdit}
              onFeedback={onFeedback}
              displayScene={displayScene ?? 'web'}
              isResponding={isResponding && isLast}
              answerIcon={answerIcon}
              citation={citation}
              dataSets={dataSets}
              isShowCitation={isShowCitation}
              isShowCitationHitInfo={isShowCitationHitInfo}
              isShowTextToSpeech={isShowTextToSpeech}
              supportAnnotation={supportAnnotation}
              appId={appId}
              question={chatList[index - 1]?.content}
              onAnnotationEdited={handleAnnotationEdited}
              onAnnotationAdded={handleAnnotationAdded}
              onAnnotationRemoved={handleAnnotationRemoved}
              allToolIcons={allToolIcons}
              isShowPromptLog={isShowPromptLog}
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
              isResponding={isResponding}
            />
          )
        })}
      </div>
      {!isHideSendInput && (
        <div className={cn(!feedbackDisabled && '!left-3.5 !right-3.5', 'absolute z-10 bottom-0 left-0 right-0')}>
          {/* Thinking is sync and can not be stopped */}
          {(isResponding && canStopResponding && ((!!chatList[chatList.length - 1]?.content) || (chatList[chatList.length - 1]?.agent_thoughts && chatList[chatList.length - 1].agent_thoughts!.length > 0))) && (
            <div className='flex justify-center mb-4'>
              <Button className='flex items-center space-x-1 bg-white' onClick={() => abortResponding?.()}>
                {stopIcon}
                <span className='text-xs text-gray-500 font-normal'>{t('appDebug.operation.stopResponding')}</span>
              </Button>
            </div>
          )}
          {isShowSuggestion && (
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
                      onClick={() => onQueryChange(item)}
                    >
                      <span className='text-primary-600 text-xs font-medium'>{item}</span>
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          )}
          <div className={cn('p-[5.5px] max-h-[150px] bg-white border-[1.5px] border-gray-200 rounded-xl overflow-y-auto', isDragActive && 'border-primary-600')}>
            {visionConfig?.enabled && (
              <>
                <div className='absolute bottom-2 left-2 flex items-center'>
                  <ChatImageUploader
                    settings={visionConfig}
                    onUpload={onUpload}
                    disabled={files.length >= visionConfig.number_limits}
                  />
                  <div className='mx-1 w-[1px] h-4 bg-black/5' />
                </div>
                <div className='pl-[52px]'>
                  <ImageList
                    list={files}
                    onRemove={onRemove}
                    onReUpload={onReUpload}
                    onImageLinkLoadSuccess={onImageLinkLoadSuccess}
                    onImageLinkLoadError={onImageLinkLoadError}
                  />
                </div>
              </>
            )}
            <Textarea
              className={`
                block w-full px-2 pr-[118px] py-[7px] leading-5 max-h-none text-sm text-gray-700 outline-none appearance-none resize-none
                ${visionConfig?.enabled && 'pl-12'}
              `}
              value={query}
              onChange={handleContentChange}
              onKeyUp={handleKeyUp}
              onKeyDown={handleKeyDown}
              onPaste={onPaste}
              onDragEnter={onDragEnter}
              onDragLeave={onDragLeave}
              onDragOver={onDragOver}
              onDrop={onDrop}
              autoSize
            />
            <div className="absolute bottom-2 right-2 flex items-center h-8">
              <div className={`${s.count} mr-4 h-5 leading-5 text-sm bg-gray-50 text-gray-500`}>{query.trim().length}</div>
              {
                query
                  ? (
                    <div className='flex justify-center items-center w-8 h-8 cursor-pointer hover:bg-gray-100 rounded-lg' onClick={() => onQueryChange('')}>
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
                  <TooltipPlus
                    popupContent={
                      <div>
                        <div>{t('common.operation.send')} Enter</div>
                        <div>{t('common.operation.lineBreak')} Shift Enter</div>
                      </div>
                    }
                  >
                    {sendBtn}
                  </TooltipPlus>
                )}
            </div>
            {voiceInputShow && (
              <VoiceInput
                onCancel={() => setVoiceInputShow(false)}
                onConverted={text => onQueryChange(text)}
              />
            )}
          </div>
        </div>
      )}
    </div>
  )
}
export default React.memo(Chat)
