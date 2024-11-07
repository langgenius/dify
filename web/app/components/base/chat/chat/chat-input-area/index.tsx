import {
  useCallback,
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
import type { InputForm } from '../type'
import { useCheckInputsForms } from '../check-input-forms-hooks'
import { useTextAreaHeight } from './hooks'
import Operation from './operation'
import cn from '@/utils/classnames'
import { FileListInChatInput } from '@/app/components/base/file-uploader'
import { useFile } from '@/app/components/base/file-uploader/hooks'
import {
  FileContextProvider,
  useFileStore,
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
  inputs?: Record<string, any>
  inputsForm?: InputForm[]
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
  inputs = {},
  inputsForm = [],
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
  const [showVoiceInput, setShowVoiceInput] = useState(false)
  const filesStore = useFileStore()
  const {
    handleDragFileEnter,
    handleDragFileLeave,
    handleDragFileOver,
    handleDropFile,
    handleClipboardPasteFile,
    isDragActive,
  } = useFile(visionConfig!)
  const { checkInputsForm } = useCheckInputsForms()

  const handleSend = () => {
    if (onSend) {
      const { files, setFiles } = filesStore.getState()
      if (files.find(item => item.transferMethod === TransferMethod.local_file && !item.uploadedId)) {
        notify({ type: 'info', message: t('appDebug.errorMessage.waitForFileUpload') })
        return
      }
      if (!query || !query.trim()) {
        notify({ type: 'info', message: t('appAnnotation.errorMessage.queryRequired') })
        return
      }
      if (checkInputsForm(inputs, inputsForm)) {
        onSend(query, files)
        setQuery('')
        setFiles([])
      }
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      setQuery(query.replace(/\n$/, ''))
      handleSend()
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
          'relative pb-[9px] bg-components-panel-bg-blur border border-components-chat-input-border rounded-xl shadow-md z-10',
          isDragActive && 'border border-dashed border-components-option-card-option-selected-border',
        )}
      >
        <div className='relative px-[9px] pt-[9px] max-h-[158px] overflow-x-hidden overflow-y-auto'>
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
                className={cn(
                  'p-1 w-full leading-6 body-lg-regular text-text-tertiary outline-none',
                )}
                placeholder={t('common.chat.inputPlaceholder') || ''}
                autoSize={{ minRows: 1 }}
                onResize={handleTextareaResize}
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value)
                  handleTextareaResize()
                }}
                onKeyDown={handleKeyDown}
                onPaste={handleClipboardPasteFile}
                onDragEnter={handleDragFileEnter}
                onDragLeave={handleDragFileLeave}
                onDragOver={handleDragFileOver}
                onDrop={handleDropFile}
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
