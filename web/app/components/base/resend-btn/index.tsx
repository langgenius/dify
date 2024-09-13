'use client'
import { t } from 'i18next'
import s from './style.module.css'
import { useChatContext } from '@/app/components/base/chat/chat/context'
import Tooltip from '@/app/components/base/tooltip'
import type { VisionFile } from '@/types/app'

type ResendBtnProps = {
  value: string
  files?: VisionFile[]
  className?: string
  isPlain?: boolean
}

const ResendBtn = ({
  value,
  files,
  className,
  isPlain,
}: ResendBtnProps) => {
  const { onSend } = useChatContext()
  return (
    <div className={`${className}`}>
      <Tooltip popupContent={t('appApi.resend')}>
        <div
          className={'box-border p-0.5 flex items-center justify-center rounded-md bg-white cursor-pointer'}
          style={!isPlain
            ? {
              boxShadow: '0px 4px 8px -2px rgba(16, 24, 40, 0.1), 0px 2px 4px -2px rgba(16, 24, 40, 0.06)',
            }
            : {}}
          onClick={() => {
            if (onSend)
              onSend(value, files)
          }}
        >
          <div className={`w-6 h-6 rounded-md hover:bg-gray-50  ${s.resendIcon}`}></div>
        </div>
      </Tooltip>
    </div>
  )
}

export default ResendBtn
