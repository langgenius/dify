import type { FC } from 'react'
import { useTranslation } from 'react-i18next'
import cn from 'classnames'
import { useEffect, useRef, useState } from 'react'
import { useClickAway } from 'ahooks'
import AgentLogDetail from './detail'
import { XClose } from '@/app/components/base/icons/src/vender/line/general'
import type { IChatItem } from '@/app/components/app/chat/type'

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
      className={cn('relative flex flex-col py-3 bg-white border-[0.5px] border-gray-200 rounded-xl shadow-xl z-10')}
      style={{
        width: 480,
        position: 'fixed',
        top: 56 + 8,
        left: 8 + (width - 480),
        bottom: 16,
      }}
      ref={ref}
    >
      <h1 className='shrink-0 px-4 py-1 text-md font-semibold text-gray-900'>{t('appLog.runDetail.workflowTitle')}</h1>
      <span className='absolute right-3 top-4 p-1 cursor-pointer z-20' onClick={onCancel}>
        <XClose className='w-4 h-4 text-gray-500' />
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
