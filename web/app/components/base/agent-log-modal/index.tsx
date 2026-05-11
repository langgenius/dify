import type { FC } from 'react'
import type { IChatItem } from '@/app/components/base/chat/chat/type'
import { cn } from '@langgenius/dify-ui/cn'
import { RiCloseLine } from '@remixicon/react'
import { useClickAway } from 'ahooks'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import AgentLogDetail from './detail'

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
      className={cn('relative z-10 flex flex-col rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-bg py-3 shadow-xl')}
      style={{
        width: 480,
        position: 'fixed',
        top: 56 + 8,
        left: 8 + (width - 480),
        bottom: 16,
      }}
      ref={ref}
    >
      <h1 className="text-md shrink-0 px-4 py-1 font-semibold text-text-primary">{t('runDetail.workflowTitle', { ns: 'appLog' })}</h1>
      <button
        type="button"
        aria-label={t('operation.close', { ns: 'common' })}
        className="absolute top-4 right-3 z-20 cursor-pointer border-none bg-transparent p-1 focus-visible:ring-1 focus-visible:ring-components-input-border-active focus-visible:outline-hidden"
        onClick={onCancel}
      >
        <RiCloseLine className="h-4 w-4 text-text-tertiary" aria-hidden="true" />
      </button>
      <AgentLogDetail
        conversationID={currentLogItem.conversationId}
        messageID={currentLogItem.id}
        log={currentLogItem}
      />
    </div>
  )
}

export default AgentLogModal
