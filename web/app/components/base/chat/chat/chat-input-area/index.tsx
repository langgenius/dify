import {
  memo,
  useCallback,
  useRef,
  useState,
} from 'react'
import Textarea from 'rc-textarea'
import { useTranslation } from 'react-i18next'
import Recorder from 'js-audio-recorder'
import type {
  EnableType,
  OnSend,
  VisionConfig,
} from '../../types'
import type { Theme } from '../../embedded-chatbot/theme/theme-context'
import { useTextAreaHeight } from './hooks'
import Operation from './operation'
import cn from '@/utils/classnames'
import { FileListFlexOperation } from '@/app/components/base/file-uploader'
import { FileContextProvider } from '@/app/components/base/file-uploader/store'
import VoiceInput from '@/app/components/base/voice-input'
import { useToastContext } from '@/app/components/base/toast'

type ChatInputAreaProps = {
  visionConfig?: VisionConfig
  speechToTextConfig?: EnableType
  onSend?: OnSend
  theme?: Theme | null
}
const ChatInputArea = ({
  visionConfig,
  speechToTextConfig = { enabled: true },
  onSend,
  theme,
}: ChatInputAreaProps) => {
  const { t } = useTranslation()
  const { notify } = useToastContext()
  const {
    wrapperRef,
    textareaRef,
    textValueRef,
    holdSpaceRef,
    handleTextareaResize,
    isMultipleLine,
  } = useTextAreaHeight()
  const [query, setQuery] = useState('')
  const isUseInputMethod = useRef(false)
  const [showVoiceInput, setShowVoiceInput] = useState(false)

  const handleSend = () => {
    if (onSend) {
      if (!query || !query.trim()) {
        notify({ type: 'info', message: t('appAnnotation.errorMessage.queryRequired') })
        return
      }
      onSend(query)
      setQuery('')
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

  const handleShowVoiceInput = useCallback(() => {
    (Recorder as any).getPermission().then(() => {
      setShowVoiceInput(true)
    }, () => {
      notify({ type: 'error', message: t('common.voiceInput.notAllow') })
    })
  }, [t, notify])

  const operation = (
    <Operation
      ref={holdSpaceRef}
      speechToTextConfig={speechToTextConfig}
      onShowVoiceInput={handleShowVoiceInput}
      onSend={handleSend}
    />
  )

  return (
    <FileContextProvider>
      <div
        className={cn(
          'py-[9px] bg-components-panel-bg-blur border border-components-chat-input-border rounded-xl shadow-md',
        )}
      >
        <div className='relative px-[9px] max-h-[158px] overflow-x-hidden overflow-y-auto'>
          <FileListFlexOperation />
          <div
            ref={wrapperRef}
            className='flex items-center justify-between'
          >
            <div className='flex items-center relative grow w-full'>
              <div
                ref={textValueRef}
                className='absolute w-auto h-auto p-1 leading-6 body-lg-regular pointer-events-none whitespace-pre invisible'
              >
                {query}
              </div>
              <Textarea
                ref={textareaRef}
                className='p-1 w-full leading-6 body-lg-regular text-text-tertiary outline-none'
                placeholder='Enter message...'
                autoSize={{ minRows: 1 }}
                onResize={handleTextareaResize}
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value)
                  handleTextareaResize()
                }}
                onKeyUp={handleKeyUp}
                onKeyDown={handleKeyDown}
              />
            </div>
            {
              !isMultipleLine && operation
            }
          </div>
          {
            showVoiceInput && (
              <VoiceInput
                onCancel={() => setShowVoiceInput(false)}
                onConverted={text => setQuery(text)}
              />
            )
          }
        </div>
        {
          isMultipleLine && (
            <div className='px-[9px]'>{operation}</div>
          )
        }
      </div>
    </FileContextProvider>
  )
}

export default memo(ChatInputArea)
