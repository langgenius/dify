import type { ReactNode } from 'react'
import type { Theme } from '../../embedded-chatbot/theme/theme-context'
import type { EnableType, OnSend } from '../../types'
import type { InputForm } from '../type'
import type { FileUpload } from '@/app/components/base/features/types'
import { cn } from '@langgenius/dify-ui/cn'
import { toast } from '@langgenius/dify-ui/toast'
import { noop } from 'es-toolkit/function'
import { decode } from 'html-entities'
import Recorder from 'js-audio-recorder'
import { useCallback, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Textarea from 'react-textarea-autosize'
import FeatureBar from '@/app/components/base/features/new-feature-panel/feature-bar'
import { FileListInChatInput } from '@/app/components/base/file-uploader'
import { useFile } from '@/app/components/base/file-uploader/hooks'
import { FileContextProvider, useFileStore } from '@/app/components/base/file-uploader/store'
import { Infotip } from '@/app/components/base/infotip'
import VoiceInput from '@/app/components/base/voice-input'
import { TransferMethod } from '@/types/app'
import { useCheckInputsForms } from '../check-input-forms-hooks'
import { useTextAreaHeight } from './hooks'
import Operation from './operation'

type AudioRecorderWithPermission = typeof Recorder & {
  getPermission: () => Promise<void>
}

type SendAcceptance = void | boolean | Promise<void | boolean>

type ChatInputAreaProps = {
  readonly?: boolean
  botName?: string
  customPlaceholder?: string
  showFeatureBar?: boolean
  showFileUpload?: boolean
  featureBarReadonly?: boolean
  featureBarDisabled?: boolean
  onFeatureBarClick?: (state: boolean) => void
  visionConfig?: FileUpload
  speechToTextConfig?: EnableType
  onSend?: OnSend
  inputs?: Record<string, unknown>
  inputsForm?: InputForm[]
  theme?: Theme | null
  isResponding?: boolean
  disabled?: boolean
  sendButtonLabel?: string
  sendButtonLoading?: boolean
  footerNotice?: ReactNode
  footerNoticeTooltip?: ReactNode
  autoFocus?: boolean
  /**
   * Controls whether pressing Enter sends the message.
   * - true (default): Enter sends, Shift+Enter inserts newline
   * - false: Enter inserts newline, Shift+Enter sends
   * Useful for CJK (Japanese/Korean/Chinese) IME users who expect Enter to insert newlines.
   */
  sendOnEnter?: boolean
}
const ChatInputArea = ({ readonly, botName, customPlaceholder, showFeatureBar, showFileUpload, featureBarReadonly = readonly, featureBarDisabled, onFeatureBarClick, visionConfig, speechToTextConfig = { enabled: true }, onSend, inputs = {}, inputsForm = [], theme, isResponding, disabled, sendButtonLabel, sendButtonLoading, footerNotice, footerNoticeTooltip, autoFocus = true, sendOnEnter = true }: ChatInputAreaProps) => {
  const { t } = useTranslation()
  const { wrapperRef, textareaRef, textValueRef, holdSpaceRef, handleTextareaResize, isMultipleLine } = useTextAreaHeight()
  const [query, setQuery] = useState('')
  const canSend = !!query.trim()
  const [showVoiceInput, setShowVoiceInput] = useState(false)
  const filesStore = useFileStore()
  const { handleDragFileEnter, handleDragFileLeave, handleDragFileOver, handleDropFile, handleClipboardPasteFile, isDragActive } = useFile(visionConfig!, false)
  const { checkInputsForm } = useCheckInputsForms()
  const historyRef = useRef([''])
  const [currentIndex, setCurrentIndex] = useState(-1)
  const isComposingRef = useRef(false)
  const queryRef = useRef('')
  const handleQueryChange = useCallback((value: string) => {
    queryRef.current = value
    setQuery(value)
    setTimeout(handleTextareaResize, 0)
  }, [handleTextareaResize])
  const resetAcceptedMessage = useCallback((acceptedQuery: string, acceptedFiles: ReturnType<typeof filesStore.getState>['files']) => {
    const { files, setFiles } = filesStore.getState()
    if (queryRef.current === acceptedQuery)
      handleQueryChange('')
    if (files === acceptedFiles)
      setFiles([])
  }, [filesStore, handleQueryChange])
  const handleSend = () => {
    if (!canSend)
      return

    if (isResponding) {
      toast.info(t($ => $['errorMessage.waitForResponse'], { ns: 'appDebug' }))
      return
    }
    if (onSend) {
      const { files } = filesStore.getState()
      if (files.some(item => item.transferMethod === TransferMethod.local_file && !item.uploadedId)) {
        toast.info(t($ => $['errorMessage.waitForFileUpload'], { ns: 'appDebug' }))
        return
      }
      if (checkInputsForm(inputs, inputsForm)) {
        const sendResult = onSend(query, files) as SendAcceptance
        if (sendResult instanceof Promise) {
          sendResult.then((accepted) => {
            if (accepted !== false)
              resetAcceptedMessage(query, files)
          }).catch(noop)
          return
        }

        if (sendResult !== false)
          resetAcceptedMessage(query, files)
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
    // Determine if this key combo should trigger send:
    // sendOnEnter=true (default): Enter sends, Shift+Enter inserts newline
    // sendOnEnter=false: Shift+Enter sends, Enter inserts newline
    const isSendCombo = sendOnEnter
      ? (e.key === 'Enter' && !e.shiftKey)
      : (e.key === 'Enter' && e.shiftKey)
    if (isSendCombo && !e.nativeEvent.isComposing) {
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
        handleQueryChange(historyRef.current[currentIndex - 1]!)
      }
    }
    else if (e.key === 'ArrowDown' && !e.shiftKey && !e.nativeEvent.isComposing && e.metaKey) {
      // When the cmd + down key is pressed, output the next element
      if (currentIndex < historyRef.current.length - 1) {
        setCurrentIndex(currentIndex + 1)
        handleQueryChange(historyRef.current[currentIndex + 1]!)
      }
      else if (currentIndex === historyRef.current.length - 1) {
        // If it is the last element, clear the input box
        setCurrentIndex(historyRef.current.length)
        handleQueryChange('')
      }
    }
  }
  const handleShowVoiceInput = useCallback(() => {
    ;(Recorder as AudioRecorderWithPermission).getPermission().then(() => {
      setShowVoiceInput(true)
    }, () => {
      toast.error(t($ => $['voiceInput.notAllow'], { ns: 'common' }))
    })
  }, [t])
  const operation = (<Operation ref={holdSpaceRef} readonly={readonly} fileConfig={visionConfig} speechToTextConfig={speechToTextConfig} onShowVoiceInput={handleShowVoiceInput} onSend={handleSend} sendButtonLabel={sendButtonLabel} sendButtonLoading={sendButtonLoading} disabled={!canSend} theme={theme} />)
  const shouldShowFooterNotice = footerNotice !== undefined && footerNotice !== null
  const shouldShowFooterNoticeTooltip = footerNoticeTooltip !== undefined && footerNoticeTooltip !== null
  const footerNoticeText = typeof footerNotice === 'string' ? footerNotice.trim() : ''
  const footerNoticeAriaLabel = footerNoticeText
    ? `${t($ => $['operation.learnMore'], { ns: 'common' })}: ${footerNoticeText}`
    : t($ => $['operation.learnMore'], { ns: 'common' })
  return (
    <>
      <div className={cn('pointer-events-auto relative z-10 overflow-hidden rounded-xl border border-components-chat-input-border bg-components-panel-bg-blur pb-[9px] shadow-md', isDragActive && 'border border-dashed border-components-option-card-option-selected-border', disabled && 'pointer-events-none border-components-panel-border opacity-50 shadow-none')}>
        <div className="relative max-h-[158px] overflow-x-hidden overflow-y-auto px-[9px] pt-[9px]">
          <FileListInChatInput fileConfig={visionConfig!} />
          <div ref={wrapperRef} className="flex items-center justify-between">
            <div className="relative flex w-full grow items-center">
              <div ref={textValueRef} className="pointer-events-none invisible absolute size-auto p-1 body-lg-regular leading-6 whitespace-pre">
                {query}
              </div>
              <Textarea
                ref={(ref) => {
                  textareaRef.current = ref ?? undefined
                }}
                className={cn('w-full resize-none bg-transparent p-1 body-lg-regular leading-6 text-text-primary outline-hidden')}
                placeholder={!readonly && customPlaceholder?.trim() ? customPlaceholder : decode(t($ => $[readonly ? 'chat.inputDisabledPlaceholder' : 'chat.inputPlaceholder'], { ns: 'common', botName }) || '')}
                // Existing chat behavior focuses the composer as soon as it opens.
                // eslint-disable-next-line jsx-a11y/no-autofocus
                autoFocus={autoFocus}
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
            {!isMultipleLine && operation}
          </div>
          {showVoiceInput && (<VoiceInput onCancel={() => setShowVoiceInput(false)} onConverted={text => handleQueryChange(text)} />)}
        </div>
        {isMultipleLine && (<div className="px-[9px]">{operation}</div>)}
      </div>
      {shouldShowFooterNotice && (
        <div className="m-1 mt-0 -translate-y-2 rounded-b-[10px] border-r border-b border-l border-components-panel-border-subtle bg-util-colors-indigo-indigo-50 px-2.5 py-2 pt-4">
          <div className="flex items-center gap-1">
            <div className="min-w-0 flex-1 body-xs-medium text-text-accent">{footerNotice}</div>
            {shouldShowFooterNoticeTooltip && (
              <Infotip
                aria-label={footerNoticeAriaLabel}
                className="ml-auto size-5 rounded-md text-text-accent hover:bg-state-base-hover hover:text-text-accent"
                iconVariant="information"
                popupClassName="max-w-80 border-0 text-start wrap-break-word"
              >
                {footerNoticeTooltip}
              </Infotip>
            )}
          </div>
        </div>
      )}
      {showFeatureBar && (
        <div className="pointer-events-auto">
          <FeatureBar showFileUpload={showFileUpload} disabled={featureBarDisabled} onFeatureBarClick={featureBarReadonly ? noop : onFeatureBarClick} hideEditEntrance={featureBarReadonly} />
        </div>
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
