import type { LLMTraceItem, NodeTracing } from '@/types/workflow'
import {
  RiArrowRightSLine,
} from '@remixicon/react'
import { useTranslation } from 'react-i18next'
import Button from '@/app/components/base/button'
import { Thinking } from '@/app/components/base/icons/src/vender/workflow'

type LLMLogTriggerProps = {
  nodeInfo: NodeTracing
  onShowLLMDetail: (detail: LLMTraceItem[]) => void
}
const LLMLogTrigger = ({
  nodeInfo,
  onShowLLMDetail,
}: LLMLogTriggerProps) => {
  const { t } = useTranslation()
  const llmTrace = nodeInfo?.execution_metadata?.llm_trace || []

  const handleShowLLMDetail = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation()
    e.nativeEvent.stopImmediatePropagation()
    onShowLLMDetail(llmTrace || [])
  }

  return (
    <Button
      className="mb-1 flex w-full items-center justify-between"
      variant="tertiary"
      onClick={handleShowLLMDetail}
    >
      <div className="flex items-center">
        <Thinking className="mr-[5px] h-4 w-4 shrink-0 text-components-button-tertiary-text" />
        {t('detail', { ns: 'runLog' })}
      </div>
      <RiArrowRightSLine className="h-4 w-4 shrink-0 text-components-button-tertiary-text" />
    </Button>
  )
}

export default LLMLogTrigger
