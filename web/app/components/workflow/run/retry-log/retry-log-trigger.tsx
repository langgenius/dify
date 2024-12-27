import { useTranslation } from 'react-i18next'
import {
  RiArrowRightSLine,
  RiRestartFill,
} from '@remixicon/react'
import Button from '@/app/components/base/button'
import type { NodeTracing } from '@/types/workflow'

type RetryLogTriggerProps = {
  nodeInfo: NodeTracing
  onShowRetryResultList: (detail: NodeTracing[]) => void
}
const RetryLogTrigger = ({
  nodeInfo,
  onShowRetryResultList,
}: RetryLogTriggerProps) => {
  const { t } = useTranslation()
  const { retryDetail } = nodeInfo

  const handleShowRetryResultList = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation()
    e.nativeEvent.stopImmediatePropagation()
    onShowRetryResultList(retryDetail || [])
  }

  return (
    <Button
      className='flex items-center justify-between mb-1 w-full'
      variant='tertiary'
      onClick={handleShowRetryResultList}
    >
      <div className='flex items-center'>
        <RiRestartFill className='mr-0.5 w-4 h-4 text-components-button-tertiary-text shrink-0' />
        {t('workflow.nodes.common.retry.retries', { num: retryDetail?.length })}
      </div>
      <RiArrowRightSLine className='w-4 h-4 text-components-button-tertiary-text shrink-0' />
    </Button>
  )
}

export default RetryLogTrigger
