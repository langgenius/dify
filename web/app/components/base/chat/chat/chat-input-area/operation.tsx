import type { FC, Ref } from 'react'
import type { Theme } from '../../embedded-chatbot/theme/theme-context'
import type {
  EnableType,
} from '../../types'
import type { FileUpload } from '@/app/components/base/features/types'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import {
  RiMicLine,
  RiSendPlane2Fill,
} from '@remixicon/react'
import { memo } from 'react'
import { useTranslation } from 'react-i18next'
import ActionButton from '@/app/components/base/action-button'
import { FileUploaderInChatInput } from '@/app/components/base/file-uploader'

type OperationProps = {
  readonly?: boolean
  fileConfig?: FileUpload
  speechToTextConfig?: EnableType
  onShowVoiceInput?: () => void
  onSend: () => void
  sendButtonLabel?: string
  disabled?: boolean
  theme?: Theme | null
  ref?: Ref<HTMLDivElement>
}
const Operation: FC<OperationProps> = ({
  readonly,
  ref,
  fileConfig,
  speechToTextConfig,
  onShowVoiceInput,
  onSend,
  sendButtonLabel,
  disabled,
  theme,
}) => {
  const { t } = useTranslation()

  return (
    <div
      className={cn(
        'flex shrink-0 items-center justify-end',
      )}
    >
      <div
        className="flex items-center pl-1"
        ref={ref}
      >
        <div className="flex items-center space-x-1">
          {fileConfig?.enabled && <FileUploaderInChatInput readonly={readonly} fileConfig={fileConfig} />}
          {
            speechToTextConfig?.enabled && (
              <ActionButton
                size="l"
                aria-label={t('voiceInput.start', { ns: 'common' })}
                disabled={readonly}
                onClick={onShowVoiceInput}
              >
                <RiMicLine className="size-5" aria-hidden="true" />
              </ActionButton>
            )
          }
        </div>
        <Button
          aria-label={sendButtonLabel ? undefined : t('operation.send', { ns: 'common' })}
          className={cn(
            'ml-3',
            sendButtonLabel ? 'px-3' : 'w-8 px-0',
          )}
          variant="primary"
          disabled={readonly || disabled}
          onClick={onSend}
          style={
            theme
              ? {
                  backgroundColor: theme.primaryColor,
                }
              : {}
          }
        >
          {sendButtonLabel || <RiSendPlane2Fill className="size-4" aria-hidden="true" />}
        </Button>
      </div>
    </div>
  )
}
Operation.displayName = 'Operation'

export default memo(Operation)
