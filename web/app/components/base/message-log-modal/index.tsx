import type { FC } from 'react'
import { useTranslation } from 'react-i18next'
import { useEffect, useRef, useState } from 'react'
import { useClickAway } from 'ahooks'
import { RiCloseLine } from '@remixicon/react'
import cn from '@/utils/classnames'
import type { IChatItem } from '@/app/components/base/chat/chat/type'
import Run from '@/app/components/workflow/run'

type MessageLogModalProps = {
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
      className={cn('relative flex flex-col pt-3 bg-components-panel-bg border-[0.5px] border-components-panel-border rounded-xl shadow-xl z-10')}
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
      <h1 className='shrink-0 px-4 py-1 text-text-primary system-xl-semibold'>{t('appLog.runDetail.title')}</h1>
      <span className='absolute right-3 top-4 p-1 cursor-pointer z-20' onClick={onCancel}>
        <RiCloseLine className='w-4 h-4 text-text-tertiary' />
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
