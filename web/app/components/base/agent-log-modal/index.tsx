import type { FC } from 'react'
import { useTranslation } from 'react-i18next'
import { RiCloseLine } from '@remixicon/react'
import { useEffect, useRef, useState } from 'react'
import { useClickAway } from 'ahooks'
import AgentLogDetail from './detail'
import cn from '@/utils/classnames'
import type { IChatItem } from '@/app/components/base/chat/chat/type'

type AgentLogModalProps = {
  currentLogItem?: IChatItem
  width: number
  onCancel: () => void
}
const AgentLogModal: FC<AgentLogModalProps> = ({
  currentLogItem,
  width,
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

  if (!currentLogItem || !currentLogItem.conversationId)
    return null

  return (
    <div
      className={cn('bg-components-panel-bg border-components-panel-border relative z-10 flex flex-col rounded-xl border-[0.5px] py-3 shadow-xl')}
      style={{
        width: 480,
        position: 'fixed',
        top: 56 + 8,
        left: 8 + (width - 480),
        bottom: 16,
      }}
      ref={ref}
    >
      <h1 className='text-md text-text-primary shrink-0 px-4 py-1 font-semibold'>{t('appLog.runDetail.workflowTitle')}</h1>
      <span className='absolute right-3 top-4 z-20 cursor-pointer p-1' onClick={onCancel}>
        <RiCloseLine className='text-text-tertiary h-4 w-4' />
      </span>
      <AgentLogDetail
        conversationID={currentLogItem.conversationId}
        messageID={currentLogItem.id}
        log={currentLogItem}
      />
    </div>
  )
}

export default AgentLogModal
