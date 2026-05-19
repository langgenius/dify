import type { FC } from 'react'
import type { IChatItem } from '@/app/components/base/chat/chat/type'
import { cn } from '@langgenius/dify-ui/cn'
import { Dialog, DialogContent, DialogTitle } from '@langgenius/dify-ui/dialog'
import { useClickAway } from 'ahooks'
import { useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { useStore } from '@/app/components/app/store'
import Run from '@/app/components/workflow/run'

type RunActiveTab = 'RESULT' | 'DETAIL' | 'TRACING'

const isRunActiveTab = (tab: string): tab is RunActiveTab =>
  tab === 'RESULT' || tab === 'DETAIL' || tab === 'TRACING'

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
  const appDetail = useStore(state => state.appDetail)

  useClickAway(() => {
    if (fixedWidth)
      onCancel()
  }, ref)

  if (!currentLogItem || !currentLogItem.workflow_run_id)
    return null

  const activeTab = isRunActiveTab(defaultTab) ? defaultTab : 'DETAIL'
  const modalContent = (
    <>
      <DialogTitle className="shrink-0 px-4 py-1 system-xl-semibold text-text-primary">{t('runDetail.title', { ns: 'appLog' })}</DialogTitle>
      <button
        type="button"
        aria-label={t('operation.close', { ns: 'common' })}
        className="absolute top-4 right-3 z-20 cursor-pointer border-none bg-transparent p-1 focus-visible:ring-1 focus-visible:ring-components-input-border-active focus-visible:outline-hidden"
        onClick={onCancel}
      >
        <span className="i-ri-close-line h-4 w-4 text-text-tertiary" aria-hidden="true" />
      </button>
      <Run
        hideResult
        activeTab={activeTab}
        runDetailUrl={`/apps/${appDetail?.id}/workflow-runs/${currentLogItem.workflow_run_id}`}
        tracingListUrl={`/apps/${appDetail?.id}/workflow-runs/${currentLogItem.workflow_run_id}/node-executions`}
      />
    </>
  )

  if (!fixedWidth) {
    return (
      <Dialog
        open
        onOpenChange={(open) => {
          if (!open)
            onCancel()
        }}
      >
        <DialogContent
          backdropClassName="bg-transparent!"
          className="top-16! bottom-4! left-[max(8px,calc(100vw-1136px))]! flex max-h-none! w-[480px]! max-w-[calc(100vw-16px)]! translate-x-0! translate-y-0! flex-col overflow-hidden! rounded-xl! border-[0.5px]! border-components-panel-border! bg-components-panel-bg! p-0! pt-3! shadow-xl!"
        >
          {modalContent}
        </DialogContent>
      </Dialog>
    )
  }

  return (
    <div
      className={cn(
        'relative z-10',
        'flex flex-col rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-bg pt-3 shadow-xl',
      )}
      style={{
        width,
        marginRight: 8,
      }}
      ref={ref}
    >
      <h1 className="shrink-0 px-4 py-1 system-xl-semibold text-text-primary">{t('runDetail.title', { ns: 'appLog' })}</h1>
      <button
        type="button"
        aria-label={t('operation.close', { ns: 'common' })}
        className="absolute top-4 right-3 z-20 cursor-pointer border-none bg-transparent p-1 focus-visible:ring-1 focus-visible:ring-components-input-border-active focus-visible:outline-hidden"
        onClick={onCancel}
      >
        <span className="i-ri-close-line h-4 w-4 text-text-tertiary" aria-hidden="true" />
      </button>
      <Run
        hideResult
        activeTab={activeTab}
        runDetailUrl={`/apps/${appDetail?.id}/workflow-runs/${currentLogItem.workflow_run_id}`}
        tracingListUrl={`/apps/${appDetail?.id}/workflow-runs/${currentLogItem.workflow_run_id}/node-executions`}
      />
    </div>
  )
}

export default MessageLogModal
