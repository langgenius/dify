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
      className='mb-1 flex w-full items-center justify-between'
      variant='tertiary'
      onClick={handleShowRetryResultList}
    >
      <div className='flex items-center'>
        <RiRestartFill className='text-components-button-tertiary-text mr-0.5 h-4 w-4 shrink-0' />
        {t('workflow.nodes.common.retry.retries', { num: retryDetail?.length })}
      </div>
      <RiArrowRightSLine className='text-components-button-tertiary-text h-4 w-4 shrink-0' />
    </Button>
  )
}

export default RetryLogTrigger
