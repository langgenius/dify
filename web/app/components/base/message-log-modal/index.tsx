import type { FC } from 'react'
import type { IChatItem } from '@/app/components/base/chat/chat/type'
import { RiCloseLine } from '@remixicon/react'
import { useClickAway } from 'ahooks'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useStore } from '@/app/components/app/store'
import Run from '@/app/components/workflow/run'
import { cn } from '@/utils/classnames'

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
  const appDetail = useStore(state => state.appDetail)

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
      className={cn('relative z-10 flex flex-col rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-bg pt-3 shadow-xl')}
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
      <h1 className="system-xl-semibold shrink-0 px-4 py-1 text-text-primary">{t('runDetail.title', { ns: 'appLog' })}</h1>
      <span className="absolute right-3 top-4 z-20 cursor-pointer p-1" onClick={onCancel}>
        <RiCloseLine className="h-4 w-4 text-text-tertiary" />
      </span>
      <Run
        hideResult
        activeTab={defaultTab as any}
        runDetailUrl={`/apps/${appDetail?.id}/workflow-runs/${currentLogItem.workflow_run_id}`}
        tracingListUrl={`/apps/${appDetail?.id}/workflow-runs/${currentLogItem.workflow_run_id}/node-executions`}
      />
    </div>
  )
}

export default MessageLogModal
