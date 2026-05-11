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
import { noop } from 'es-toolkit/function'
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
                <RiMicLine className="h-5 w-5" aria-hidden="true" />
              </ActionButton>
            )
          }
        </div>
        <Button
          aria-label={t('operation.send', { ns: 'common' })}
          className="ml-3 w-8 px-0"
          variant="primary"
          onClick={readonly ? noop : onSend}
          style={
            theme
              ? {
                  backgroundColor: theme.primaryColor,
                }
              : {}
          }
        >
          <RiSendPlane2Fill className="h-4 w-4" aria-hidden="true" />
        </Button>
      </div>
    </div>
  )
}
Operation.displayName = 'Operation'

export default memo(Operation)
