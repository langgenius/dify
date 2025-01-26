import { useTranslation } from 'react-i18next'
import { RiArrowRightSLine } from '@remixicon/react'
import Button from '@/app/components/base/button'
import type {
  LoopDurationMap,
  NodeTracing,
} from '@/types/workflow'
import { Loop } from '@/app/components/base/icons/src/vender/workflow'

type LoopLogTriggerProps = {
  nodeInfo: NodeTracing
  onShowLoopResultList: (loopResultList: NodeTracing[][], loopResultDurationMap: LoopDurationMap) => void
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
    onShowLoopResultList(nodeInfo.details || [], nodeInfo?.loopDurationMap || nodeInfo.execution_metadata?.loop_duration_map || {})
  }
  return (
    <Button
      className='flex items-center w-full self-stretch gap-2 px-3 py-2 bg-components-button-tertiary-bg-hover hover:bg-components-button-tertiary-bg-hover rounded-lg cursor-pointer border-none'
      onClick={handleOnShowLoopDetail}
    >
      <Loop className='w-4 h-4 text-components-button-tertiary-text shrink-0' />
      <div className='flex-1 text-left system-sm-medium text-components-button-tertiary-text'>{t('workflow.nodes.loop.loop', { count: getCount(nodeInfo.details?.length, nodeInfo.metadata?.loop_length) })}{getErrorCount(nodeInfo.details) > 0 && (
        <>
          {t('workflow.nodes.loop.comma')}
          {t('workflow.nodes.loop.error', { count: getErrorCount(nodeInfo.details) })}
        </>
      )}</div>
      <RiArrowRightSLine className='w-4 h-4 text-components-button-tertiary-text shrink-0' />
    </Button>
  )
}

export default LoopLogTrigger
