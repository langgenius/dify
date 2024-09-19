import {
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
} from '../../types'
import type { Theme } from '../../embedded-chatbot/theme/theme-context'
import { useTextAreaHeight } from './hooks'
import Operation from './operation'
import cn from '@/utils/classnames'
import { FileListInChatInput } from '@/app/components/base/file-uploader'
import {
  FileContextProvider,
  useStore,
} from '@/app/components/base/file-uploader/store'
import VoiceInput from '@/app/components/base/voice-input'
import { useToastContext } from '@/app/components/base/toast'
import FeatureBar from '@/app/components/base/features/new-feature-panel/feature-bar'
import type { FileUpload } from '@/app/components/base/features/types'
import { TransferMethod } from '@/types/app'

type ChatInputAreaProps = {
  showFeatureBar?: boolean
  showFileUpload?: boolean
  featureBarDisabled?: boolean
  onFeatureBarClick?: (state: boolean) => void
  visionConfig?: FileUpload
  speechToTextConfig?: EnableType
  onSend?: OnSend
  theme?: Theme | null
}
const ChatInputArea = ({
  showFeatureBar,
  showFileUpload,
  featureBarDisabled,
  onFeatureBarClick,
  visionConfig,
  speechToTextConfig = { enabled: true },
  onSend,
  // theme,
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
  const files = useStore(s => s.files)
  const setFiles = useStore(s => s.setFiles)

  const handleSend = () => {
    if (onSend) {
      if (files.find(item => item.type === TransferMethod.local_file && !item.fileStorageId)) {
        notify({ type: 'info', message: t('appDebug.errorMessage.waitForImgUpload') })
        return
      }
      if (!query || !query.trim()) {
        notify({ type: 'info', message: t('appAnnotation.errorMessage.queryRequired') })
        return
      }
      onSend(query, files)
      setQuery('')
      setFiles([])
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
      visionConfig={visionConfig}
      speechToTextConfig={speechToTextConfig}
      onShowVoiceInput={handleShowVoiceInput}
      onSend={handleSend}
    />
  )

  return (
    <>
      <div
        className={cn(
          'relative py-[9px] bg-components-panel-bg-blur border border-components-chat-input-border rounded-xl shadow-md z-10',
        )}
      >
        <div className='relative px-[9px] max-h-[158px] overflow-x-hidden overflow-y-auto'>
          <FileListInChatInput fileConfig={visionConfig!} />
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
      {showFeatureBar && <FeatureBar showFileUpload={showFileUpload} disabled={featureBarDisabled} onFeatureBarClick={onFeatureBarClick} />}
    </>
  )
}

const ChatInputAreaWrapper = (props: ChatInputAreaProps) => {
  return (
    <FileContextProvider>
      <ChatInputArea {...props} />
    </FileContextProvider>
  )
}

export default ChatInputAreaWrapper
