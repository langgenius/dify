import type { FC } from 'react'
import type { IChatItem } from '@/app/components/base/chat/chat/type'
import { cn } from '@langgenius/dify-ui/cn'
import { RiCloseLine } from '@remixicon/react'
import { useClickAway } from 'ahooks'
import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { useStore } from '@/app/components/app/store'
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
  const titleId = useId()
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

  const floatingWidth = 480
  const content = (
    <div
      role="dialog"
      aria-labelledby={titleId}
      className={cn(
        fixedWidth ? 'relative z-10' : 'fixed z-50',
        'flex flex-col rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-bg pt-3 shadow-xl',
      )}
      style={{
        width: fixedWidth ? width : floatingWidth,
        ...(!fixedWidth
          ? {
              top: 56 + 8,
              left: Math.max(8, 8 + (width - floatingWidth)),
              bottom: 16,
              maxWidth: 'calc(100vw - 16px)',
            }
          : {
              marginRight: 8,
            }),
      }}
      ref={ref}
    >
      <h1 id={titleId} className="shrink-0 px-4 py-1 system-xl-semibold text-text-primary">{t('runDetail.title', { ns: 'appLog' })}</h1>
      <button
        type="button"
        aria-label={t('operation.close', { ns: 'common' })}
        className="absolute top-4 right-3 z-20 cursor-pointer border-none bg-transparent p-1 focus-visible:ring-1 focus-visible:ring-components-input-border-active focus-visible:outline-hidden"
        onClick={onCancel}
      >
        <RiCloseLine className="h-4 w-4 text-text-tertiary" aria-hidden="true" />
      </button>
      <Run
        hideResult
        activeTab={defaultTab as any}
        runDetailUrl={`/apps/${appDetail?.id}/workflow-runs/${currentLogItem.workflow_run_id}`}
        tracingListUrl={`/apps/${appDetail?.id}/workflow-runs/${currentLogItem.workflow_run_id}/node-executions`}
      />
    </div>
  )

  if (!fixedWidth && typeof document !== 'undefined')
    return createPortal(content, document.body)

  return content
}

export default MessageLogModal
