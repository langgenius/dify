import type {
  LoopDurationMap,
  LoopVariableMap,
  NodeTracing,
} from '@/types/workflow'
import { RiArrowRightSLine } from '@remixicon/react'
import { useTranslation } from 'react-i18next'
import Button from '@/app/components/base/button'
import { Loop } from '@/app/components/base/icons/src/vender/workflow'

type LoopLogTriggerProps = {
  nodeInfo: NodeTracing
  allExecutions?: NodeTracing[]
  onShowLoopResultList: (loopResultList: NodeTracing[][], loopResultDurationMap: LoopDurationMap, loopVariableMap: LoopVariableMap) => void
}
const LoopLogTrigger = ({
  nodeInfo,
  allExecutions,
  onShowLoopResultList,
}: LoopLogTriggerProps) => {
  const { t } = useTranslation()

  const filterNodesForInstance = (key: string): NodeTracing[] => {
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
        exec.execution_metadata?.loop_id === nodeInfo.node_id
        && exec.execution_metadata?.loop_index === serialIndex,
      )
      if (serialNodes.length > 0)
        return serialNodes
    }

    return []
  }

  const handleOnShowLoopDetail = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation()
    e.nativeEvent.stopImmediatePropagation()

    const loopNodeMeta = nodeInfo.execution_metadata
    const loopDurMap = nodeInfo?.loopDurationMap || loopNodeMeta?.loop_duration_map || {}
    const loopVarMap = loopNodeMeta?.loop_variable_map || {}

    let structuredList: NodeTracing[][] = []
    if (nodeInfo.details?.length) {
      structuredList = nodeInfo.details
    }
    else if (loopNodeMeta?.loop_duration_map) {
      const instanceKeys = Object.keys(loopNodeMeta.loop_duration_map)
      structuredList = instanceKeys
        .map(key => filterNodesForInstance(key))
        .filter(branchNodes => branchNodes.length > 0)
    }

    onShowLoopResultList(
      structuredList,
      loopDurMap,
      loopVarMap,
    )
  }

  let displayLoopCount = 0
  const loopMap = nodeInfo.execution_metadata?.loop_duration_map
  if (loopMap)
    displayLoopCount = Object.keys(loopMap).length
  else if (nodeInfo.details?.length)
    displayLoopCount = nodeInfo.details.length
  else if (nodeInfo.metadata?.loop_length)
    displayLoopCount = nodeInfo.metadata.loop_length

  const getErrorCount = (details: NodeTracing[][] | undefined) => {
    if (!details || details.length === 0)
      return 0
    return details.reduce((acc, loop) => {
      if (loop.some(item => item.status === 'failed'))
        acc++
      return acc
    }, 0)
  }
  const errorCount = getErrorCount(nodeInfo.details)

  return (
    <Button
      className="flex w-full cursor-pointer items-center gap-2 self-stretch rounded-lg border-none bg-components-button-tertiary-bg-hover px-3 py-2 hover:bg-components-button-tertiary-bg-hover"
      onClick={handleOnShowLoopDetail}
    >
      <Loop className="h-4 w-4 shrink-0 text-components-button-tertiary-text" />
      <div className="system-sm-medium flex-1 text-left text-components-button-tertiary-text">
        {t('nodes.loop.loop', { ns: 'workflow', count: displayLoopCount })}
        {errorCount > 0 && (
          <>
            {t('nodes.loop.comma', { ns: 'workflow' })}
            {t('nodes.loop.error', { ns: 'workflow', count: errorCount })}
          </>
        )}
      </div>
      <RiArrowRightSLine className="h-4 w-4 shrink-0 text-components-button-tertiary-text" />
    </Button>
  )
}

export default LoopLogTrigger
