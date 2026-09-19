import type { IterationDurationMap, NodeTracing } from '@/types/workflow'
import { Button } from '@langgenius/dify-ui/button'
import { RiArrowRightSLine } from '@remixicon/react'
import { useTranslation } from 'react-i18next'
import { Iteration } from '@/app/components/base/icons/src/vender/workflow'
import { NodeRunningStatus } from '@/app/components/workflow/types'
import { getIterationDurationMap, getIterationResultList } from '../utils/format-log/iteration'

type IterationLogTriggerProps = {
  nodeInfo: NodeTracing
  allExecutions?: NodeTracing[]
  onShowIterationResultList: (
    iterationResultList: NodeTracing[][],
    iterationResultDurationMap: IterationDurationMap,
  ) => void
}

const getDisplayIterationCount = (nodeInfo: NodeTracing) => {
  const iterationDurationMap = nodeInfo.execution_metadata?.iteration_duration_map
  if (iterationDurationMap) return Object.keys(iterationDurationMap).length
  if (nodeInfo.details?.length) return nodeInfo.details.length
  return nodeInfo.metadata?.iterator_length ?? 0
}

const getFailedIterationIndices = (
  details: NodeTracing[][] | undefined,
  nodeInfo: NodeTracing,
  allExecutions?: NodeTracing[],
) => {
  if (!details?.length) return new Set<number>()

  const failedIterationIndices = new Set<number>()

  details.forEach((iteration, index) => {
    if (!iteration.some((item) => item.status === NodeRunningStatus.Failed)) return

    const iterationIndex = iteration[0]?.execution_metadata?.iteration_index ?? index
    failedIterationIndices.add(iterationIndex)
  })

  if (!nodeInfo.execution_metadata?.iteration_duration_map || !allExecutions)
    return failedIterationIndices

  allExecutions.forEach((execution) => {
    if (
      execution.execution_metadata?.iteration_id === nodeInfo.node_id &&
      execution.status === NodeRunningStatus.Failed &&
      execution.execution_metadata?.iteration_index !== undefined
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

  const handleOnShowIterationDetail = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation()
    e.nativeEvent.stopImmediatePropagation()

    onShowIterationResultList(
      getIterationResultList(nodeInfo, allExecutions),
      getIterationDurationMap(nodeInfo),
    )
  }

  const displayIterationCount = getDisplayIterationCount(nodeInfo)
  const errorCount = getFailedIterationIndices(nodeInfo.details, nodeInfo, allExecutions).size

  return (
    <Button
      className="flex w-full cursor-pointer items-center self-stretch rounded-lg bg-components-button-tertiary-bg-hover px-3 py-2 inset-ring-0 hover:bg-components-button-tertiary-bg-hover"
      onClick={handleOnShowIterationDetail}
    >
      {/* oxlint-disable-next-line dify/prefer-tailwind-icons */}
      <Iteration className="size-4 shrink-0 text-components-button-tertiary-text" />
      <div className="flex-1 text-left system-sm-medium text-components-button-tertiary-text">
        {t(($) => $['nodes.iteration.iteration'], { ns: 'workflow', count: displayIterationCount })}
        {errorCount > 0 && (
          <>
            {t(($) => $['nodes.iteration.comma'], { ns: 'workflow' })}
            {t(($) => $['nodes.iteration.error'], { ns: 'workflow', count: errorCount })}
          </>
        )}
      </div>
      {/* oxlint-disable-next-line dify/prefer-tailwind-icons */}
      <RiArrowRightSLine className="size-4 shrink-0 text-components-button-tertiary-text" />
    </Button>
  )
}

export default IterationLogTrigger
