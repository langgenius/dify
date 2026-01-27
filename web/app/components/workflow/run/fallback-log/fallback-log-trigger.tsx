import type { NodeTracing } from '@/types/workflow'
import {
  RiArrowGoForwardLine,
  RiArrowRightSLine,
} from '@remixicon/react'
import { useTranslation } from 'react-i18next'
import Button from '@/app/components/base/button'

type FallbackLogTriggerProps = {
  nodeInfo: NodeTracing
  onShowFallbackResultList: (detail: NodeTracing[]) => void
}
const FallbackLogTrigger = ({
  nodeInfo,
  onShowFallbackResultList,
}: FallbackLogTriggerProps) => {
  const { t } = useTranslation()
  const { fallbackDetail } = nodeInfo

  const handleShowFallbackResultList = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation()
    e.nativeEvent.stopImmediatePropagation()
    onShowFallbackResultList(fallbackDetail || [])
  }

  return (
    <Button
      className="mb-1 flex w-full items-center justify-between"
      variant="tertiary"
      onClick={handleShowFallbackResultList}
    >
      <div className="flex items-center">
        <RiArrowGoForwardLine className="mr-0.5 h-4 w-4 shrink-0 text-components-button-tertiary-text" />
        {t('nodes.common.fallback.attempts', { ns: 'workflow', num: fallbackDetail?.length })}
      </div>
      <RiArrowRightSLine className="h-4 w-4 shrink-0 text-components-button-tertiary-text" />
    </Button>
  )
}

export default FallbackLogTrigger
