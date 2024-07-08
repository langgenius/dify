import type { FC } from 'react'
import { useTranslation } from 'react-i18next'
import cn from 'classnames'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useBoolean, useClickAway } from 'ahooks'
import { RiCloseLine } from '@remixicon/react'
import IterationResultPanel from '../../workflow/run/iteration-result-panel'
import type { IChatItem } from '@/app/components/base/chat/chat/type'
import Run from '@/app/components/workflow/run'
import type { NodeTracing } from '@/types/workflow'

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

  const [iterationRunResult, setIterationRunResult] = useState<NodeTracing[][]>([])
  const [isShowIterationDetail, {
    setTrue: doShowIterationDetail,
    setFalse: doHideIterationDetail,
  }] = useBoolean(false)

  const handleShowIterationDetail = useCallback((detail: NodeTracing[][]) => {
    setIterationRunResult(detail)
    doShowIterationDetail()
  }, [doShowIterationDetail])

  if (!currentLogItem || !currentLogItem.workflow_run_id)
    return null

  return (
    <div
      className={cn('relative flex flex-col py-3 bg-white border-[0.5px] border-gray-200 rounded-xl shadow-xl z-10')}
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
      {isShowIterationDetail
        ? (
          <IterationResultPanel
            list={iterationRunResult}
            onHide={doHideIterationDetail}
            onBack={doHideIterationDetail}
          />
        )
        : (
          <>
            <h1 className='shrink-0 px-4 py-1 text-md font-semibold text-gray-900'>{t('appLog.runDetail.title')}</h1>
            <span className='absolute right-3 top-4 p-1 cursor-pointer z-20' onClick={onCancel}>
              <RiCloseLine className='w-4 h-4 text-gray-500' />
            </span>
            <Run
              hideResult activeTab={defaultTab as any}
              runID={currentLogItem.workflow_run_id}
              onShowIterationDetail={handleShowIterationDetail}
            />
          </>
        )}

    </div>
  )
}

export default MessageLogModal
