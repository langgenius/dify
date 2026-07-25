import type { FC, Ref } from 'react'
import type { Theme } from '../../embedded-chatbot/theme/theme-context'
import type { EnableType } from '../../types'
import type { FileUpload } from '@/app/components/base/features/types'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
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
  sendButtonLoading?: boolean
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
  sendButtonLoading,
  disabled,
  theme,
}) => {
  const { t } = useTranslation()

  return (
    <div className={cn('flex shrink-0 items-center justify-end')}>
      <div className="flex items-center pl-1" ref={ref}>
        <div className="flex items-center gap-1">
          {fileConfig?.enabled && (
            <FileUploaderInChatInput readonly={readonly} fileConfig={fileConfig} />
          )}
          {speechToTextConfig?.enabled && onShowVoiceInput && (
            <ActionButton
              className="shrink-0 outline-hidden focus-visible:inset-ring-2 focus-visible:inset-ring-state-accent-solid"
              size="l"
              aria-label={t(($) => $['voiceInput.start'], { ns: 'common' })}
              disabled={readonly}
              onClick={onShowVoiceInput}
            >
              <span className="i-ri-mic-line size-5" aria-hidden="true" />
            </ActionButton>
          )}
        </div>
        <Button
          aria-label={sendButtonLabel ? undefined : t(($) => $['operation.send'], { ns: 'common' })}
          className={cn('ml-3 focus-visible:ring-inset', sendButtonLabel ? 'px-3' : 'w-8 px-0')}
          variant="primary"
          disabled={readonly || disabled}
          loading={sendButtonLoading}
          onClick={onSend}
          style={
            theme
              ? {
                  backgroundColor: theme.primaryColor,
                }
              : {}
          }
        >
          {sendButtonLabel || <span className="i-ri-send-plane-2-fill size-4" aria-hidden="true" />}
        </Button>
      </div>
    </div>
  )
}
Operation.displayName = 'Operation'

export default memo(Operation)
