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
      className={cn('relative flex flex-col py-3 bg-components-panel-bg border-[0.5px] border-components-panel-border rounded-xl shadow-xl z-10')}
      style={{
        width: 480,
        position: 'fixed',
        top: 56 + 8,
        left: 8 + (width - 480),
        bottom: 16,
      }}
      ref={ref}
    >
      <h1 className='shrink-0 px-4 py-1 text-md font-semibold text-text-primary'>{t('appLog.runDetail.workflowTitle')}</h1>
      <span className='absolute right-3 top-4 p-1 cursor-pointer z-20' onClick={onCancel}>
        <RiCloseLine className='w-4 h-4 text-text-tertiary' />
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
