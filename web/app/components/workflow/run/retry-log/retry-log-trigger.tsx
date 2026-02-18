import type { NodeTracing } from '@/types/workflow'
import {
  RiArrowRightSLine,
  RiRestartFill,
} from '@remixicon/react'
import { useTranslation } from 'react-i18next'
import Button from '@/app/components/base/button'

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
      className="mb-1 flex w-full items-center justify-between"
      variant="tertiary"
      onClick={handleShowRetryResultList}
    >
      <div className="flex items-center">
        <RiRestartFill className="mr-0.5 h-4 w-4 shrink-0 text-components-button-tertiary-text" />
        {t('nodes.common.retry.retries', { ns: 'workflow', num: retryDetail?.length })}
      </div>
      <RiArrowRightSLine className="h-4 w-4 shrink-0 text-components-button-tertiary-text" />
    </Button>
  )
}

export default RetryLogTrigger
