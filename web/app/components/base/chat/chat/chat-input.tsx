import type { FC } from 'react'
import {
  memo,
  useRef,
  useState,
} from 'react'
import { useContext } from 'use-context-selector'
import Recorder from 'js-audio-recorder'
import { useTranslation } from 'react-i18next'
import Textarea from 'rc-textarea'
import type {
  EnableType,
  OnSend,
  VisionConfig,
} from '../types'
import { TransferMethod } from '../types'
import { useChatWithHistoryContext } from '../chat-with-history/context'
import type { Theme } from '../embedded-chatbot/theme/theme-context'
import { CssTransform } from '../embedded-chatbot/theme/utils'
import TooltipPlus from '@/app/components/base/tooltip-plus'
import { ToastContext } from '@/app/components/base/toast'
import useBreakpoints, { MediaType } from '@/hooks/use-breakpoints'
import VoiceInput from '@/app/components/base/voice-input'
import { Microphone01 } from '@/app/components/base/icons/src/vender/line/mediaAndDevices'
import { Microphone01 as Microphone01Solid } from '@/app/components/base/icons/src/vender/solid/mediaAndDevices'
import { XCircle } from '@/app/components/base/icons/src/vender/solid/general'
import { Send03 } from '@/app/components/base/icons/src/vender/solid/communication'
import ChatImageUploader from '@/app/components/base/image-uploader/chat-image-uploader'
import ImageList from '@/app/components/base/image-uploader/image-list'
import {
  useClipboardUploader,
  useDraggableUploader,
  useImageFiles,
} from '@/app/components/base/image-uploader/hooks'

type ChatInputProps = {
  visionConfig?: VisionConfig
  speechToTextConfig?: EnableType
  onSend?: OnSend
  theme?: Theme | null
}
const ChatInput: FC<ChatInputProps> = ({
  visionConfig,
  speechToTextConfig,
  onSend,
  theme,
}) => {
  const { appData } = useChatWithHistoryContext()
  const { t } = useTranslation()
  const { notify } = useContext(ToastContext)
  const [voiceInputShow, setVoiceInputShow] = useState(false)
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
  const [query, setQuery] = useState('')
  const handleContentChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value
    setQuery(value)
  }

  const handleSend = () => {
    if (onSend) {
      if (files.find(item => item.type === TransferMethod.local_file && !item.fileId)) {
        notify({ type: 'info', message: t('appDebug.errorMessage.waitForImgUpload') })
        return
      }
      if (!query || !query.trim()) {
        notify({ type: 'info', message: t('appAnnotation.errorMessage.queryRequired') })
        return
      }
      onSend(query, files.filter(file => file.progress !== -1).map(fileItem => ({
        type: 'image',
        transfer_method: fileItem.type,
        url: fileItem.url,
        upload_file_id: fileItem.fileId,
      })))
      setQuery('')
      onClear()
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
      setQuery(query.replace(/\n$/, ''))
      e.preventDefault()
    }
  }

  const logError = (message: string) => {
    notify({ type: 'error', message, duration: 3000 })
  }
  const handleVoiceInputShow = () => {
    (Recorder as any).getPermission().then(() => {
      setVoiceInputShow(true)
    }, () => {
      logError(t('common.voiceInput.notAllow'))
    })
  }

  const [isActiveIconFocused, setActiveIconFocused] = useState(false)

  const media = useBreakpoints()
  const isMobile = media === MediaType.mobile
  const sendIconThemeStyle = theme
    ? {
      color: (isActiveIconFocused || query || (query.trim() !== '')) ? theme.primaryColor : '#d1d5db',
    }
    : {}
  const sendBtn = (
    <div
      className='group flex items-center justify-center w-8 h-8 rounded-lg hover:bg-[#EBF5FF] cursor-pointer'
      onMouseEnter={() => setActiveIconFocused(true)}
      onMouseLeave={() => setActiveIconFocused(false)}
      onClick={handleSend}
      style={isActiveIconFocused ? CssTransform(theme?.chatBubbleColorStyle ?? '') : {}}
    >
      <Send03
        style={sendIconThemeStyle}
        className={`
          w-5 h-5 text-gray-300 group-hover:text-primary-600
          ${!!query.trim() && 'text-primary-600'}
        `}
      />
    </div>
  )

  return (
    <>
      <div className='relative'>
        <div
          className={`
            p-[5.5px] max-h-[150px] bg-white border-[1.5px] border-gray-200 rounded-xl overflow-y-auto
            ${isDragActive && 'border-primary-600'} mb-2
          `}
        >
          {
            visionConfig?.enabled && (
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
            )
          }
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
          <div className='absolute bottom-[7px] right-2 flex items-center h-8'>
            <div className='flex items-center px-1 h-5 rounded-md bg-gray-100 text-xs font-medium text-gray-500'>
              {query.trim().length}
            </div>
            {
              query
                ? (
                  <div className='flex justify-center items-center ml-2 w-8 h-8 cursor-pointer hover:bg-gray-100 rounded-lg' onClick={() => setQuery('')}>
                    <XCircle className='w-4 h-4 text-[#98A2B3]' />
                  </div>
                )
                : speechToTextConfig?.enabled
                  ? (
                    <div
                      className='group flex justify-center items-center ml-2 w-8 h-8 hover:bg-primary-50 rounded-lg cursor-pointer'
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
      {appData?.site?.custom_disclaimer && <div className='text-xs text-gray-500 mt-1 text-center'>
        {appData.site.custom_disclaimer}
      </div>}
    </>
  )
}

export default memo(ChatInput)
