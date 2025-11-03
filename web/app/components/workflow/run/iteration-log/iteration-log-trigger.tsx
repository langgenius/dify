import { useTranslation } from 'react-i18next'
import { RiArrowRightSLine } from '@remixicon/react'
import Button from '@/app/components/base/button'
import type {
  IterationDurationMap,
  NodeTracing,
} from '@/types/workflow'
import { NodeRunningStatus } from '@/app/components/workflow/types'
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

      // Also include failed iterations that might not be in duration map
      if (allExecutions && nodeInfo.details?.length) {
        const existingIterationIndices = new Set<number>()
        structuredList.forEach((iteration) => {
          iteration.forEach((node) => {
            if (node.execution_metadata?.iteration_index !== undefined)
              existingIterationIndices.add(node.execution_metadata.iteration_index)
          })
        })

        // Find failed iterations that are not in the structured list
        nodeInfo.details.forEach((iteration, index) => {
          if (!existingIterationIndices.has(index) && iteration.some(node => node.status === NodeRunningStatus.Failed))
            structuredList.push(iteration)
        })

        // Sort by iteration index to maintain order
        structuredList.sort((a, b) => {
          const aIndex = a[0]?.execution_metadata?.iteration_index ?? 0
          const bIndex = b[0]?.execution_metadata?.iteration_index ?? 0
          return aIndex - bIndex
        })
      }
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

  const getErrorCount = (details: NodeTracing[][] | undefined, iterationNodeMeta?: any) => {
    if (!details || details.length === 0)
      return 0

    let errorCount = 0

    // Count errors from details (this includes all iterations, including failed ones)
    errorCount = details.reduce((acc, iteration) => {
      if (iteration.some(item => item.status === NodeRunningStatus.Failed))
        acc++
      return acc
    }, 0)

    // If we have iteration_duration_map, we need to also check for failed iterations
    // that might not be in the duration map but are in allExecutions
    if (iterationNodeMeta?.iteration_duration_map && allExecutions) {
      const instanceKeys = Object.keys(iterationNodeMeta.iteration_duration_map)
      const coveredIterationIndices = new Set<number>()

      instanceKeys.forEach((key) => {
        const nodes = filterNodesForInstance(key)
        nodes.forEach((node) => {
          if (node.execution_metadata?.iteration_index !== undefined)
            coveredIterationIndices.add(node.execution_metadata.iteration_index)
        })
      })

      // Check for additional failed iterations not covered by duration map
      const additionalFailedIterations = allExecutions.filter(exec =>
        exec.execution_metadata?.iteration_id === nodeInfo.node_id
        && exec.status === NodeRunningStatus.Failed
        && exec.execution_metadata?.iteration_index !== undefined
        && !coveredIterationIndices.has(exec.execution_metadata.iteration_index),
      )

      const additionalFailedIterationIndices = new Set(
        additionalFailedIterations.map(exec => exec.execution_metadata?.iteration_index),
      )

      errorCount += additionalFailedIterationIndices.size
    }

    return errorCount
  }
  const errorCount = getErrorCount(nodeInfo.details, nodeInfo.execution_metadata)

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
