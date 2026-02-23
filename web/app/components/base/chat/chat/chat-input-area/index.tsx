import type { Theme } from '../../embedded-chatbot/theme/theme-context'
import type {
  EnableType,
  OnSend,
} from '../../types'
import type { InputForm } from '../type'
import type { FileUpload } from '@/app/components/base/features/types'
import { noop } from 'es-toolkit/function'
import { decode } from 'html-entities'
import Recorder from 'js-audio-recorder'
import {
  useCallback,
  useRef,
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'
import Textarea from 'react-textarea-autosize'
import FeatureBar from '@/app/components/base/features/new-feature-panel/feature-bar'
import { FileListInChatInput } from '@/app/components/base/file-uploader'
import { useFile } from '@/app/components/base/file-uploader/hooks'
import {
  FileContextProvider,
  useFileStore,
} from '@/app/components/base/file-uploader/store'
import { useToastContext } from '@/app/components/base/toast'
import VoiceInput from '@/app/components/base/voice-input'
import { TransferMethod } from '@/types/app'
import { cn } from '@/utils/classnames'
import { useCheckInputsForms } from '../check-input-forms-hooks'
import { useTextAreaHeight } from './hooks'
import Operation from './operation'

type ChatInputAreaProps = {
  readonly?: boolean
  botName?: string
  showFeatureBar?: boolean
  showFileUpload?: boolean
  featureBarDisabled?: boolean
  onFeatureBarClick?: (state: boolean) => void
  visionConfig?: FileUpload
  speechToTextConfig?: EnableType
  onSend?: OnSend
  inputs?: Record<string, any>
  inputsForm?: InputForm[]
  theme?: Theme | null
  isResponding?: boolean
  disabled?: boolean
}
const ChatInputArea = ({
  readonly,
  botName,
  showFeatureBar,
  showFileUpload,
  featureBarDisabled,
  onFeatureBarClick,
  visionConfig,
  speechToTextConfig = { enabled: true },
  onSend,
  inputs = {},
  inputsForm = [],
  theme,
  isResponding,
  disabled,
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
  const [showVoiceInput, setShowVoiceInput] = useState(false)
  const filesStore = useFileStore()
  const {
    handleDragFileEnter,
    handleDragFileLeave,
    handleDragFileOver,
    handleDropFile,
    handleClipboardPasteFile,
    isDragActive,
  } = useFile(visionConfig!, false)
  const { checkInputsForm } = useCheckInputsForms()
  const historyRef = useRef([''])
  const [currentIndex, setCurrentIndex] = useState(-1)
  const isComposingRef = useRef(false)

  const handleQueryChange = useCallback(
    (value: string) => {
      setQuery(value)
      setTimeout(handleTextareaResize, 0)
    },
    [handleTextareaResize],
  )

  const handleSend = () => {
    if (isResponding) {
      notify({ type: 'info', message: t('errorMessage.waitForResponse', { ns: 'appDebug' }) })
      return
    }

    if (onSend) {
      const { files, setFiles } = filesStore.getState()
      if (files.find(item => item.transferMethod === TransferMethod.local_file && !item.uploadedId)) {
        notify({ type: 'info', message: t('errorMessage.waitForFileUpload', { ns: 'appDebug' }) })
        return
      }
      if (!query || !query.trim()) {
        notify({ type: 'info', message: t('errorMessage.queryRequired', { ns: 'appAnnotation' }) })
        return
      }
      if (checkInputsForm(inputs, inputsForm)) {
        onSend(query, files)
        handleQueryChange('')
        setFiles([])
      }
    }
  }
  const handleCompositionStart = () => {
    // e: React.CompositionEvent<HTMLTextAreaElement>
    isComposingRef.current = true
  }
  const handleCompositionEnd = () => {
    // safari or some browsers will trigger compositionend before keydown.
    // delay 50ms for safari.
    setTimeout(() => {
      isComposingRef.current = false
    }, 50)
  }
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      // if isComposing, exit
      if (isComposingRef.current)
        return
      e.preventDefault()
      setQuery(query.replace(/\n$/, ''))
      historyRef.current.push(query)
      setCurrentIndex(historyRef.current.length)
      handleSend()
    }
    else if (e.key === 'ArrowUp' && !e.shiftKey && !e.nativeEvent.isComposing && e.metaKey) {
      // When the cmd + up key is pressed, output the previous element
      if (currentIndex > 0) {
        setCurrentIndex(currentIndex - 1)
        handleQueryChange(historyRef.current[currentIndex - 1])
      }
    }
    else if (e.key === 'ArrowDown' && !e.shiftKey && !e.nativeEvent.isComposing && e.metaKey) {
      // When the cmd + down key is pressed, output the next element
      if (currentIndex < historyRef.current.length - 1) {
        setCurrentIndex(currentIndex + 1)
        handleQueryChange(historyRef.current[currentIndex + 1])
      }
      else if (currentIndex === historyRef.current.length - 1) {
        // If it is the last element, clear the input box
        setCurrentIndex(historyRef.current.length)
        handleQueryChange('')
      }
    }
  }

  const handleShowVoiceInput = useCallback(() => {
    (Recorder as any).getPermission().then(() => {
      setShowVoiceInput(true)
    }, () => {
      notify({ type: 'error', message: t('voiceInput.notAllow', { ns: 'common' }) })
    })
  }, [t, notify])

  const operation = (
    <Operation
      ref={holdSpaceRef}
      readonly={readonly}
      fileConfig={visionConfig}
      speechToTextConfig={speechToTextConfig}
      onShowVoiceInput={handleShowVoiceInput}
      onSend={handleSend}
      theme={theme}
    />
  )

  return (
    <>
      <div
        className={cn(
          'relative z-10 overflow-hidden rounded-xl border border-components-chat-input-border bg-components-panel-bg-blur pb-[9px] shadow-md',
          isDragActive && 'border border-dashed border-components-option-card-option-selected-border',
          disabled && 'pointer-events-none border-components-panel-border opacity-50 shadow-none',
        )}
      >
        <div className="relative max-h-[158px] overflow-y-auto overflow-x-hidden px-[9px] pt-[9px]">
          <FileListInChatInput fileConfig={visionConfig!} />
          <div
            ref={wrapperRef}
            className="flex items-center justify-between"
          >
            <div className="relative flex w-full grow items-center">
              <div
                ref={textValueRef}
                className="body-lg-regular pointer-events-none invisible absolute h-auto w-auto whitespace-pre p-1 leading-6"
              >
                {query}
              </div>
              <Textarea
                ref={ref => textareaRef.current = ref as any}
                className={cn(
                  'body-lg-regular w-full resize-none bg-transparent p-1 leading-6 text-text-primary outline-none',
                )}
                placeholder={decode(t(readonly ? 'chat.inputDisabledPlaceholder' : 'chat.inputPlaceholder', { ns: 'common', botName }) || '')}
                autoFocus
                minRows={1}
                value={query}
                onChange={e => handleQueryChange(e.target.value)}
                onKeyDown={handleKeyDown}
                onCompositionStart={handleCompositionStart}
                onCompositionEnd={handleCompositionEnd}
                onPaste={handleClipboardPasteFile}
                onDragEnter={handleDragFileEnter}
                onDragLeave={handleDragFileLeave}
                onDragOver={handleDragFileOver}
                onDrop={handleDropFile}
                readOnly={readonly}
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
                onConverted={text => handleQueryChange(text)}
              />
            )
          }
        </div>
        {
          isMultipleLine && (
            <div className="px-[9px]">{operation}</div>
          )
        }
      </div>
      {showFeatureBar && (
        <FeatureBar
          showFileUpload={showFileUpload}
          disabled={featureBarDisabled}
          onFeatureBarClick={readonly ? noop : onFeatureBarClick}
          hideEditEntrance={readonly}
        />
      )}
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
