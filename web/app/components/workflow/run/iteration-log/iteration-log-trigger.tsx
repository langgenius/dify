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
  allExecutions?: NodeTracing[]
  onShowIterationResultList: (iterationResultList: NodeTracing[][], iterationResultDurationMap: IterationDurationMap) => void
}
const IterationLogTrigger = ({
  nodeInfo,
  allExecutions,
  onShowIterationResultList,
}: IterationLogTriggerProps) => {
  const { t } = useTranslation()

  const filterNodesForInstance = (key: string): NodeTracing[] => {
    if (!allExecutions) return []

    const parallelNodes = allExecutions.filter(exec =>
      exec.execution_metadata?.parallel_mode_run_id === key,
    )
    if (parallelNodes.length > 0)
      return parallelNodes

    const serialIndex = Number.parseInt(key, 10)
    if (!isNaN(serialIndex)) {
      const serialNodes = allExecutions.filter(exec =>
        exec.execution_metadata?.iteration_id === nodeInfo.node_id
        && exec.execution_metadata?.iteration_index === serialIndex,
      )
      if (serialNodes.length > 0)
        return serialNodes
    }

    return []
  }

  const handleOnShowIterationDetail = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation()
    e.nativeEvent.stopImmediatePropagation()

    const iterationNodeMeta = nodeInfo.execution_metadata
    const iterDurationMap = nodeInfo?.iterDurationMap || iterationNodeMeta?.iteration_duration_map || {}

    let structuredList: NodeTracing[][] = []
    if (iterationNodeMeta?.iteration_duration_map) {
      const instanceKeys = Object.keys(iterationNodeMeta.iteration_duration_map)
      structuredList = instanceKeys
        .map(key => filterNodesForInstance(key))
        .filter(branchNodes => branchNodes.length > 0)
    }
    else if (nodeInfo.details?.length) {
      structuredList = nodeInfo.details
    }

    onShowIterationResultList(structuredList, iterDurationMap)
  }

  let displayIterationCount = 0
  const iterMap = nodeInfo.execution_metadata?.iteration_duration_map
  if (iterMap)
    displayIterationCount = Object.keys(iterMap).length
  else if (nodeInfo.details?.length)
    displayIterationCount = nodeInfo.details.length
  else if (nodeInfo.metadata?.iterator_length)
    displayIterationCount = nodeInfo.metadata.iterator_length

  const getErrorCount = (details: NodeTracing[][] | undefined) => {
    if (!details || details.length === 0)
      return 0
    return details.reduce((acc, iteration) => {
      if (iteration.some(item => item.status === 'failed'))
        acc++
      return acc
    }, 0)
  }
  const errorCount = getErrorCount(nodeInfo.details)

  return (
    <Button
      className='flex w-full cursor-pointer items-center gap-2 self-stretch rounded-lg border-none bg-components-button-tertiary-bg-hover px-3 py-2 hover:bg-components-button-tertiary-bg-hover'
      onClick={handleOnShowIterationDetail}
    >
      <Iteration className='h-4 w-4 shrink-0 text-components-button-tertiary-text' />
      <div className='system-sm-medium flex-1 text-left text-components-button-tertiary-text'>{t('workflow.nodes.iteration.iteration', { count: displayIterationCount })}{errorCount > 0 && (
        <>
          {t('workflow.nodes.iteration.comma')}
          {t('workflow.nodes.iteration.error', { count: errorCount })}
        </>
      )}</div>
      <RiArrowRightSLine className='h-4 w-4 shrink-0 text-components-button-tertiary-text' />
    </Button>
  )
}

export default IterationLogTrigger
