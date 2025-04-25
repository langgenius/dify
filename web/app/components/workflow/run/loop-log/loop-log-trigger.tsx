import { useTranslation } from 'react-i18next'
import { RiArrowRightSLine } from '@remixicon/react'
import Button from '@/app/components/base/button'
import type {
  LoopDurationMap,
  LoopVariableMap,
  NodeTracing,
} from '@/types/workflow'
import { Loop } from '@/app/components/base/icons/src/vender/workflow'

type LoopLogTriggerProps = {
  nodeInfo: NodeTracing
  onShowLoopResultList: (loopResultList: NodeTracing[][], loopResultDurationMap: LoopDurationMap, loopVariableMap: LoopVariableMap) => void
}
const LoopLogTrigger = ({
  nodeInfo,
  onShowLoopResultList,
}: LoopLogTriggerProps) => {
  const { t } = useTranslation()
  const getErrorCount = (details: NodeTracing[][] | undefined) => {
    if (!details || details.length === 0)
      return 0

    return details.reduce((acc, loop) => {
      if (loop.some(item => item.status === 'failed'))
        acc++
      return acc
    }, 0)
  }
  const getCount = (loop_curr_length: number | undefined, loop_length: number) => {
    if ((loop_curr_length && loop_curr_length < loop_length) || !loop_length)
      return loop_curr_length

    return loop_length
  }
  const handleOnShowLoopDetail = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation()
    e.nativeEvent.stopImmediatePropagation()
    onShowLoopResultList(
      nodeInfo.details || [],
      nodeInfo?.loopDurationMap || nodeInfo.execution_metadata?.loop_duration_map || {},
      nodeInfo.execution_metadata?.loop_variable_map || {},
    )
  }
  return (
    <Button
      className='flex w-full cursor-pointer items-center gap-2 self-stretch rounded-lg border-none bg-components-button-tertiary-bg-hover px-3 py-2 hover:bg-components-button-tertiary-bg-hover'
      onClick={handleOnShowLoopDetail}
    >
      <Loop className='h-4 w-4 shrink-0 text-components-button-tertiary-text' />
      <div className='system-sm-medium flex-1 text-left text-components-button-tertiary-text'>{t('workflow.nodes.loop.loop', { count: getCount(nodeInfo.details?.length, nodeInfo.metadata?.loop_length) })}{getErrorCount(nodeInfo.details) > 0 && (
        <>
          {t('workflow.nodes.loop.comma')}
          {t('workflow.nodes.loop.error', { count: getErrorCount(nodeInfo.details) })}
        </>
      )}</div>
      <RiArrowRightSLine className='h-4 w-4 shrink-0 text-components-button-tertiary-text' />
    </Button>
  )
}

export default LoopLogTrigger
