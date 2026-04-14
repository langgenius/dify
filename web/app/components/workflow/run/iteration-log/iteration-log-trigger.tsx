import type {
  IterationDurationMap,
  NodeTracing,
} from '@/types/workflow'
import { RiArrowRightSLine } from '@remixicon/react'
import { useTranslation } from 'react-i18next'
import { Iteration } from '@/app/components/base/icons/src/vender/workflow'
import { Button } from '@/app/components/base/ui/button'
import { NodeRunningStatus } from '@/app/components/workflow/types'

type IterationLogTriggerProps = {
  nodeInfo: NodeTracing
  allExecutions?: NodeTracing[]
  onShowIterationResultList: (iterationResultList: NodeTracing[][], iterationResultDurationMap: IterationDurationMap) => void
}

const getIterationDurationMap = (nodeInfo: NodeTracing) => {
  return nodeInfo.iterDurationMap || nodeInfo.execution_metadata?.iteration_duration_map || {}
}

const getDisplayIterationCount = (nodeInfo: NodeTracing) => {
  const iterationDurationMap = nodeInfo.execution_metadata?.iteration_duration_map
  if (iterationDurationMap)
    return Object.keys(iterationDurationMap).length
  if (nodeInfo.details?.length)
    return nodeInfo.details.length
  return nodeInfo.metadata?.iterator_length ?? 0
}

const getFailedIterationIndices = (
  details: NodeTracing[][] | undefined,
  nodeInfo: NodeTracing,
  allExecutions?: NodeTracing[],
) => {
  if (!details?.length)
    return new Set<number>()

  const failedIterationIndices = new Set<number>()

  details.forEach((iteration, index) => {
    if (!iteration.some(item => item.status === NodeRunningStatus.Failed))
      return

    const iterationIndex = iteration[0]?.execution_metadata?.iteration_index ?? index
    failedIterationIndices.add(iterationIndex)
  })

  if (!nodeInfo.execution_metadata?.iteration_duration_map || !allExecutions)
    return failedIterationIndices

  allExecutions.forEach((execution) => {
    if (
      execution.execution_metadata?.iteration_id === nodeInfo.node_id
      && execution.status === NodeRunningStatus.Failed
      && execution.execution_metadata?.iteration_index !== undefined
    ) {
      failedIterationIndices.add(execution.execution_metadata.iteration_index)
    }
  })

  return failedIterationIndices
}

const IterationLogTrigger = ({
  nodeInfo,
  allExecutions,
  onShowIterationResultList,
}: IterationLogTriggerProps) => {
  const { t } = useTranslation()

  const getNodesForInstance = (key: string): NodeTracing[] => {
    if (!allExecutions)
      return []

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

  const getStructuredIterationList = () => {
    const iterationNodeMeta = nodeInfo.execution_metadata

    if (!iterationNodeMeta?.iteration_duration_map)
      return nodeInfo.details || []

    const structuredList = Object.keys(iterationNodeMeta.iteration_duration_map)
      .map(getNodesForInstance)
      .filter(branchNodes => branchNodes.length > 0)

    if (!allExecutions || !nodeInfo.details?.length)
      return structuredList

    const existingIterationIndices = new Set<number>()
    structuredList.forEach((iteration) => {
      iteration.forEach((node) => {
        if (node.execution_metadata?.iteration_index !== undefined)
          existingIterationIndices.add(node.execution_metadata.iteration_index)
      })
    })

    nodeInfo.details.forEach((iteration, index) => {
      if (
        !existingIterationIndices.has(index)
        && iteration.some(node => node.status === NodeRunningStatus.Failed)
      ) {
        structuredList.push(iteration)
      }
    })

    return structuredList.sort((a, b) => {
      const aIndex = a[0]?.execution_metadata?.iteration_index ?? 0
      const bIndex = b[0]?.execution_metadata?.iteration_index ?? 0
      return aIndex - bIndex
    })
  }

  const handleOnShowIterationDetail = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation()
    e.nativeEvent.stopImmediatePropagation()

    onShowIterationResultList(getStructuredIterationList(), getIterationDurationMap(nodeInfo))
  }

  const displayIterationCount = getDisplayIterationCount(nodeInfo)
  const errorCount = getFailedIterationIndices(nodeInfo.details, nodeInfo, allExecutions).size

  return (
    <Button
      className="flex w-full cursor-pointer items-center gap-2 self-stretch rounded-lg border-none bg-components-button-tertiary-bg-hover px-3 py-2 hover:bg-components-button-tertiary-bg-hover"
      onClick={handleOnShowIterationDetail}
    >
      {/* eslint-disable-next-line hyoban/prefer-tailwind-icons */}
      <Iteration className="h-4 w-4 shrink-0 text-components-button-tertiary-text" />
      <div className="flex-1 text-left system-sm-medium text-components-button-tertiary-text">
        {t('nodes.iteration.iteration', { ns: 'workflow', count: displayIterationCount })}
        {errorCount > 0 && (
          <>
            {t('nodes.iteration.comma', { ns: 'workflow' })}
            {t('nodes.iteration.error', { ns: 'workflow', count: errorCount })}
          </>
        )}
      </div>
      {/* eslint-disable-next-line hyoban/prefer-tailwind-icons */}
      <RiArrowRightSLine className="h-4 w-4 shrink-0 text-components-button-tertiary-text" />
    </Button>
  )
}

export default IterationLogTrigger
