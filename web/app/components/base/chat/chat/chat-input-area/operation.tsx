import {
  forwardRef,
  memo,
} from 'react'
import {
  RiArrowUpLine,
  RiGlobalLine,
  RiMicLine,
} from '@remixicon/react'
import type {
  EnableType,
} from '../../types'
import type { Theme } from '../../embedded-chatbot/theme/theme-context'
import Button from '@/app/components/base/button'
import ActionButton from '@/app/components/base/action-button'
import { FileUploaderInChatInput } from '@/app/components/base/file-uploader'
import type { FileUpload } from '@/app/components/base/features/types'
import cn from '@/utils/classnames'
import { t } from 'i18next'

type OperationProps = {
  fileConfig?: FileUpload
  speechToTextConfig?: EnableType
  onShowVoiceInput?: () => void
  onSend: () => void
  theme?: Theme | null
  isInternet?: boolean
  onSetInternet?: (internet: boolean) => void
}
const Operation = forwardRef<HTMLDivElement, OperationProps>(({
  fileConfig,
  speechToTextConfig,
  onShowVoiceInput,
  onSend,
  onSetInternet,
  theme,
  isInternet = false,
}, ref) => {
  return (
    <div
      className={cn(
        'shrink-0 flex items-center justify-between',
      )}
    >
      <div
        className='flex items-center justify-center text-xs text-black px-4 py-4 h-6 rounded-full'
        style={
          isInternet ? {
            backgroundColor: theme?.backgroundHoverColor,
            color: theme?.primaryColor,
            cursor: 'pointer',
            border: '1px solid rgab(0,0,0,0.12)',
          } : {
            cursor: 'pointer',
            border: '1px solid rgba(0,122,255,0.15)',
          }

        }
        onClick={() => onSetInternet?.(!isInternet)}
      >
        <RiGlobalLine className='w-5 h-5 mr-2' />
        {t('common.chat.buttonInternet') || ''}
      </div>
      <div
        className='flex items-center pl-1'
        ref={ref}
      >
        <div className='flex items-center space-x-1'>
          {fileConfig?.enabled && <FileUploaderInChatInput fileConfig={fileConfig} />}
          {
            speechToTextConfig?.enabled && (
              <ActionButton
                size='l'
                onClick={onShowVoiceInput}
              >
                <RiMicLine className='w-5 h-5' />
              </ActionButton>
            )
          }
        </div>
        <Button
          className='ml-3 px-0 w-8 rounded-full'
          variant='primary'
          onClick={onSend}
          style={
            theme
              ? {
                backgroundColor: theme.primaryColor,
              }
              : {}
          }
        >
          <RiArrowUpLine className='w-6 h-6' />
        </Button>
      </div>
    </div>
  )
})
Operation.displayName = 'Operation'

export default memo(Operation)
