import {
  memo,
  useCallback,
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
  const [value, setValue] = useState('')
  const [showVoiceInput, setShowVoiceInput] = useState(false)

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
    />
  )

  return (
    <div
      className={cn(
        'py-[9px] bg-components-panel-bg-blur border border-blue-300 rounded-xl shadow-md',
      )}
    >
      <div className='relative px-[9px] max-h-[158px] overflow-y-auto'>
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
              {value}
            </div>
            <Textarea
              ref={textareaRef}
              className='p-1 w-full leading-6 body-lg-regular text-text-tertiary outline-none'
              placeholder='Enter message...'
              autoSize={{ minRows: 1 }}
              onResize={handleTextareaResize}
              value={value}
              onChange={(e) => {
                setValue(e.target.value)
                handleTextareaResize()
              }}
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
              onConverted={text => setValue(text)}
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
  )
}

export default memo(ChatInputArea)
