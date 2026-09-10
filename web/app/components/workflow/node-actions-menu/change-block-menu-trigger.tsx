import type { CommonNodeType, Node, OnSelectBlock } from '@/app/components/workflow/types'
import { intersection } from 'es-toolkit/array'
import { useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import BlockSelector from '@/app/components/workflow/block-selector'
import { useHooksStore } from '@/app/components/workflow/hooks-store'
import useNodes from '@/app/components/workflow/store/workflow/use-nodes'
import { BlockEnum, isTriggerNode } from '@/app/components/workflow/types'
import { getNodeCatalogType } from '@/app/components/workflow/utils'
import { FlowType } from '@/types/common'
import { useAvailableBlocks } from '../hooks/use-available-blocks'
import { useNodesInteractions } from '../hooks/use-nodes-interactions'
import { useIsChatMode } from '../hooks/use-workflow'

type ChangeBlockMenuTriggerProps = {
  nodeId: string
  nodeData: Node['data']
  sourceHandle: string
}

export function ChangeBlockMenuTrigger({
  nodeId,
  nodeData,
  sourceHandle,
}: ChangeBlockMenuTriggerProps) {
  const { t } = useTranslation()
  const { handleNodeChange } = useNodesInteractions()
  const nodeCatalogType = getNodeCatalogType(nodeData)
  const { availablePrevBlocks, availableNextBlocks } = useAvailableBlocks(
    nodeCatalogType,
    nodeData.isInIteration || nodeData.isInLoop,
  )
  const isChatMode = useIsChatMode()
  const flowType = useHooksStore((s) => s.configsMap?.flowType)
  const nodes = useNodes()
  const hasStartNode = useMemo(() => {
    return nodes.some((n) => (n.data as CommonNodeType | undefined)?.type === BlockEnum.Start)
  }, [nodes])
  const showStartTab =
    flowType !== FlowType.ragPipeline &&
    (!isChatMode || nodeData.type === BlockEnum.Start || !hasStartNode)
  const ignoreNodeIds = useMemo(() => {
    if (isTriggerNode(nodeData.type as BlockEnum) || nodeData.type === BlockEnum.Start)
      return [nodeId]
    return undefined
  }, [nodeData.type, nodeId])
  const allowStartNodeSelection = !hasStartNode

  const availableNodes = useMemo(() => {
    if (availablePrevBlocks.length && availableNextBlocks.length)
      return intersection(availablePrevBlocks, availableNextBlocks)
    if (availablePrevBlocks.length) return availablePrevBlocks
    return availableNextBlocks
  }, [availablePrevBlocks, availableNextBlocks])

  const handleSelect = useCallback<OnSelectBlock>(
    (type, pluginDefaultValue) => {
      handleNodeChange(nodeId, type, sourceHandle, pluginDefaultValue)
    },
    [handleNodeChange, nodeId, sourceHandle],
  )

  const triggerElement = (
    <button
      type="button"
      className="mx-1 flex h-8 w-[calc(100%-8px)] cursor-pointer items-center rounded-lg border-0 bg-transparent px-2 text-left text-sm text-text-secondary outline-hidden select-none hover:bg-state-base-hover focus-visible:bg-state-base-hover focus-visible:outline-hidden"
    >
      {t(($) => $['panel.changeBlock'], { ns: 'workflow' })}
    </button>
  )

  return (
    <BlockSelector
      onSelect={handleSelect}
      trigger={triggerElement}
      popupClassName="min-w-[240px]"
      availableBlocksTypes={availableNodes}
      showStartTab={showStartTab}
      ignoreNodeIds={ignoreNodeIds}
      forceEnableStartTab={nodeData.type === BlockEnum.Start}
      allowUserInputSelection={allowStartNodeSelection}
      isolateKeyboardEvents
    />
  )
}
