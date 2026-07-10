import type { FC } from 'react'
import type { IChatItem } from '@/app/components/base/chat/chat/type'
import { cn } from '@langgenius/dify-ui/cn'
import { Dialog, DialogContent, DialogTitle } from '@langgenius/dify-ui/dialog'
import { RiCloseLine } from '@remixicon/react'
import { useClickAway } from 'ahooks'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import AgentLogDetail from './detail'

type AgentLogModalProps = Readonly<{
  currentLogItem?: IChatItem
  width: number
  floating?: boolean
  onCancel: () => void
}>
const AgentLogModal: FC<AgentLogModalProps> = ({
  currentLogItem,
  width,
  floating,
  onCancel,
}) => {
  const { t } = useTranslation()
  const ref = useRef(null)
  const [mounted, setMounted] = useState(false)

  useClickAway(() => {
    if (mounted && !floating)
      onCancel()
  }, ref)

  useEffect(() => {
    setMounted(true)
  }, [])

  if (!currentLogItem || !currentLogItem.conversationId)
    return null

  const detailContent = (
    <>
      <AgentLogDetail
        conversationID={currentLogItem.conversationId}
        messageID={currentLogItem.id}
        log={currentLogItem}
      />
    </>
  )

  if (floating) {
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
          className="top-16! bottom-4! left-[max(8px,calc(100vw-1136px))]! flex max-h-none! w-[480px]! max-w-[calc(100vw-16px)]! translate-x-0! translate-y-0! flex-col overflow-hidden! rounded-xl! border-[0.5px]! border-components-panel-border! bg-components-panel-bg! p-0! pt-3! pb-3! shadow-xl!"
        >
          <DialogTitle className="text-md shrink-0 px-4 py-1 font-semibold text-text-primary">{t($ => $['runDetail.workflowTitle'], { ns: 'appLog' })}</DialogTitle>
          <button
            type="button"
            aria-label={t($ => $['operation.close'], { ns: 'common' })}
            className="absolute top-4 right-3 z-20 cursor-pointer border-none bg-transparent p-1 focus-visible:ring-1 focus-visible:ring-components-input-border-active focus-visible:outline-hidden"
            onClick={onCancel}
          >
            <RiCloseLine className="size-4 text-text-tertiary" aria-hidden="true" />
          </button>
          {detailContent}
        </DialogContent>
      </Dialog>
    )
  }

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
      <h1 className="text-md shrink-0 px-4 py-1 font-semibold text-text-primary">{t($ => $['runDetail.workflowTitle'], { ns: 'appLog' })}</h1>
      <button
        type="button"
        aria-label={t($ => $['operation.close'], { ns: 'common' })}
        className="absolute top-4 right-3 z-20 cursor-pointer border-none bg-transparent p-1 focus-visible:ring-1 focus-visible:ring-components-input-border-active focus-visible:outline-hidden"
        onClick={onCancel}
      >
        <RiCloseLine className="size-4 text-text-tertiary" aria-hidden="true" />
      </button>
      {detailContent}
    </div>
  )
}

export default AgentLogModal
