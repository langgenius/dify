import type { CommonNodeType, Node, OnSelectBlock } from '@/app/components/workflow/types'
import { PopoverClose, PopoverPopup, PopoverTitle } from '@langgenius/dify-ui/popover'
import { intersection } from 'es-toolkit/array'
import { useCallback, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { BlockSelectorContent } from '@/app/components/workflow/block-selector'
import { useHooksStore } from '@/app/components/workflow/hooks-store'
import useNodes from '@/app/components/workflow/store/workflow/use-nodes'
import { BlockEnum, isTriggerNode } from '@/app/components/workflow/types'
import { getNodeCatalogType } from '@/app/components/workflow/utils'
import { FlowType } from '@/types/common'
import { useAvailableBlocks } from '../hooks/use-available-blocks'
import { useNodesInteractions } from '../hooks/use-nodes-interactions'
import { useIsChatMode } from '../hooks/use-workflow'

type ChangeBlockPopupProps = {
  nodeId: string
  nodeData: Node['data']
  sourceHandle: string
  onComplete: () => void
}

export function ChangeBlockPopup({
  nodeId,
  nodeData,
  sourceHandle,
  onComplete,
}: ChangeBlockPopupProps) {
  const { t } = useTranslation()
  const searchInputRef = useRef<HTMLInputElement>(null)
  const completedRef = useRef(false)
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

  const handleComplete = useCallback(() => {
    completedRef.current = true
    onComplete()
  }, [onComplete])

  const handleSelect = useCallback<OnSelectBlock>(
    (type, pluginDefaultValue) => {
      handleComplete()
      handleNodeChange(nodeId, type, sourceHandle, pluginDefaultValue)
    },
    [handleNodeChange, nodeId, sourceHandle, handleComplete],
  )

  return (
    <PopoverPopup
      initialFocus={searchInputRef}
      finalFocus={() => !completedRef.current}
      className="w-100 overflow-hidden rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-bg shadow-lg"
      onKeyDown={(event) => event.stopPropagation()}
    >
      <PopoverTitle className="sr-only">
        {t(($) => $['panel.changeBlock'], { ns: 'workflow' })}
      </PopoverTitle>
      <BlockSelectorContent
        onSelect={handleSelect}
        onRequestClose={handleComplete}
        searchInputRef={searchInputRef}
        availableBlocksTypes={availableNodes}
        showStartTab={showStartTab}
        ignoreNodeIds={ignoreNodeIds}
        forceEnableStartTab={nodeData.type === BlockEnum.Start}
        allowUserInputSelection={allowStartNodeSelection}
      />
      <PopoverClose className="sr-only" tabIndex={-1}>
        {t(($) => $['operation.close'], { ns: 'common' })}
      </PopoverClose>
    </PopoverPopup>
  )
}
