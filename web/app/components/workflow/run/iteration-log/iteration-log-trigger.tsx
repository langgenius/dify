import { useTranslation } from 'react-i18next'
import { RiArrowRightSLine } from '@remixicon/react'
import Button from '@/app/components/base/button'
import type {
  IterationDurationMap,
  NodeTracing,
} from '@/types/workflow'
import { Iteration } from '@/app/components/base/icons/src/vender/workflow'

type IterationLogTriggerProps = {
  nodeInfo: NodeTracing
  onShowIterationResultList: (iterationResultList: NodeTracing[][], iterationResultDurationMap: IterationDurationMap) => void
}
const IterationLogTrigger = ({
  nodeInfo,
  onShowIterationResultList,
}: IterationLogTriggerProps) => {
  const { t } = useTranslation()
  const getErrorCount = (details: NodeTracing[][] | undefined) => {
    if (!details || details.length === 0)
      return 0

    return details.reduce((acc, iteration) => {
      if (iteration.some(item => item.status === 'failed'))
        acc++
      return acc
    }, 0)
  }
  const getCount = (iteration_curr_length: number | undefined, iteration_length: number) => {
    if ((iteration_curr_length && iteration_curr_length < iteration_length) || !iteration_length)
      return iteration_curr_length

    return iteration_length
  }
  const handleOnShowIterationDetail = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation()
    e.nativeEvent.stopImmediatePropagation()
    onShowIterationResultList(nodeInfo.details || [], nodeInfo?.iterDurationMap || nodeInfo.execution_metadata?.iteration_duration_map || {})
  }
  return (
    <Button
      className='flex items-center w-full self-stretch gap-2 px-3 py-2 bg-components-button-tertiary-bg-hover hover:bg-components-button-tertiary-bg-hover rounded-lg cursor-pointer border-none'
      onClick={handleOnShowIterationDetail}
    >
      <Iteration className='w-4 h-4 text-components-button-tertiary-text shrink-0' />
      <div className='flex-1 text-left system-sm-medium text-components-button-tertiary-text'>{t('workflow.nodes.iteration.iteration', { count: getCount(nodeInfo.details?.length, nodeInfo.metadata?.iterator_length) })}{getErrorCount(nodeInfo.details) > 0 && (
        <>
          {t('workflow.nodes.iteration.comma')}
          {t('workflow.nodes.iteration.error', { count: getErrorCount(nodeInfo.details) })}
        </>
      )}</div>
      <RiArrowRightSLine className='w-4 h-4 text-components-button-tertiary-text shrink-0' />
    </Button>
  )
}

export default IterationLogTrigger
