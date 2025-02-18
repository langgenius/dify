import type { FC } from 'react'
import { useTranslation } from 'react-i18next'
import { useEffect, useRef, useState } from 'react'
import { useClickAway } from 'ahooks'
import { RiCloseLine } from '@remixicon/react'
import cn from '@/utils/classnames'
import type { IChatItem } from '@/app/components/base/chat/chat/type'
import Run from '@/app/components/workflow/run'

interface MessageLogModalProps {
  currentLogItem?: IChatItem
  defaultTab?: string
  width: number
  fixedWidth?: boolean
  onCancel: () => void
}
const MessageLogModal: FC<MessageLogModalProps> = ({
  currentLogItem,
  defaultTab = 'DETAIL',
  width,
  fixedWidth,
  onCancel,
}) => {
  const { t } = useTranslation()
  const ref = useRef(null)
  const [mounted, setMounted] = useState(false)

  useClickAway(() => {
    if (mounted)
      onCancel()
  }, ref)

  useEffect(() => {
    setMounted(true)
  }, [])

  if (!currentLogItem || !currentLogItem.workflow_run_id)
    return null

  return (
    <div
      className={cn('bg-components-panel-bg border-components-panel-border relative z-10 flex flex-col rounded-xl border-[0.5px] pt-3 shadow-xl')}
      style={{
        width: fixedWidth ? width : 480,
        ...(!fixedWidth
          ? {
            position: 'fixed',
            top: 56 + 8,
            left: 8 + (width - 480),
            bottom: 16,
          }
          : {
            marginRight: 8,
          }),
      }}
      ref={ref}
    >
      <h1 className='text-text-primary system-xl-semibold shrink-0 px-4 py-1'>{t('appLog.runDetail.title')}</h1>
      <span className='absolute right-3 top-4 z-20 cursor-pointer p-1' onClick={onCancel}>
        <RiCloseLine className='text-text-tertiary h-4 w-4' />
      </span>
      <Run
        hideResult
        activeTab={defaultTab as any}
        runID={currentLogItem.workflow_run_id}
      />
    </div>
  )
}

export default MessageLogModal
