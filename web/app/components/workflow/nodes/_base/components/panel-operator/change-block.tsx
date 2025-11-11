import {
  memo,
  useCallback,
  useMemo,
} from 'react'
import { useTranslation } from 'react-i18next'
import { intersection } from 'lodash-es'
import { useNodes } from 'reactflow'
import BlockSelector from '@/app/components/workflow/block-selector'
import {
  useAvailableBlocks,
  useIsChatMode,
  useNodesInteractions,
} from '@/app/components/workflow/hooks'
import { useHooksStore } from '@/app/components/workflow/hooks-store'
import type {
  CommonNodeType,
  Node,
  OnSelectBlock,
} from '@/app/components/workflow/types'
import { BlockEnum } from '@/app/components/workflow/types'

const TRIGGER_NODE_TYPES: BlockEnum[] = [
  BlockEnum.TriggerSchedule,
  BlockEnum.TriggerWebhook,
  BlockEnum.TriggerPlugin,
]
import { FlowType } from '@/types/common'

type ChangeBlockProps = {
  nodeId: string
  nodeData: Node['data']
  sourceHandle: string
}
const ChangeBlock = ({
  nodeId,
  nodeData,
  sourceHandle,
}: ChangeBlockProps) => {
  const { t } = useTranslation()
  const { handleNodeChange } = useNodesInteractions()
  const nodes = useNodes<CommonNodeType>()
  const {
    availablePrevBlocks,
    availableNextBlocks,
  } = useAvailableBlocks(nodeData.type, nodeData.isInIteration || nodeData.isInLoop)
  const isChatMode = useIsChatMode()
  const flowType = useHooksStore(s => s.configsMap?.flowType)
  const showStartTab = flowType !== FlowType.ragPipeline && !isChatMode
  // Count total trigger nodes
  const totalTriggerNodes = useMemo(() => (
    nodes.filter(node => TRIGGER_NODE_TYPES.includes(node.data.type as BlockEnum)).length
  ), [nodes])
  // Check if there is a User Input node
  const hasUserInputNode = useMemo(() => (
    nodes.some(node => node.data.type === BlockEnum.Start)
  ), [nodes])
  // Check if the current node is a trigger node
  const isTriggerNode = TRIGGER_NODE_TYPES.includes(nodeData.type as BlockEnum)
  // Force enabling Start tab regardless of existing trigger/user input nodes (e.g., when changing Start node type).
  const forceEnableStartTab = isTriggerNode || nodeData.type === BlockEnum.Start
  // Only allow converting a trigger into User Input when it's the sole trigger and no User Input exists yet.
  const canChangeTriggerToUserInput = isTriggerNode && !hasUserInputNode && totalTriggerNodes === 1
  // Ignore current node when it's a trigger so the Start tab logic doesn't treat it as existing trigger.
  const ignoreNodeIds = useMemo(() => {
    if (TRIGGER_NODE_TYPES.includes(nodeData.type as BlockEnum))
      return [nodeId]
    return undefined
  }, [nodeData.type, nodeId])
  // Determine user input selection based on node type and trigger/user input node presence.
  const allowUserInputSelection = forceEnableStartTab
    ? (nodeData.type === BlockEnum.Start ? false : canChangeTriggerToUserInput)
    : undefined

  const availableNodes = useMemo(() => {
    if (availablePrevBlocks.length && availableNextBlocks.length)
      return intersection(availablePrevBlocks, availableNextBlocks)
    else if (availablePrevBlocks.length)
      return availablePrevBlocks
    else
      return availableNextBlocks
  }, [availablePrevBlocks, availableNextBlocks])

  const handleSelect = useCallback<OnSelectBlock>((type, pluginDefaultValue) => {
    handleNodeChange(nodeId, type, sourceHandle, pluginDefaultValue)
  }, [handleNodeChange, nodeId, sourceHandle])

  const renderTrigger = useCallback(() => {
    return (
      <div className='flex h-8 w-[232px] cursor-pointer items-center rounded-lg px-3 text-sm text-text-secondary hover:bg-state-base-hover'>
        {t('workflow.panel.changeBlock')}
      </div>
    )
  }, [t])

  return (
    <BlockSelector
      placement='bottom-end'
      offset={{
        mainAxis: -36,
        crossAxis: 4,
      }}
      onSelect={handleSelect}
      trigger={renderTrigger}
      popupClassName='min-w-[240px]'
      availableBlocksTypes={availableNodes}
      showStartTab={showStartTab}
      ignoreNodeIds={ignoreNodeIds}
      // When changing Start/Trigger nodes, force-enable Start tab to allow switching among entry nodes.
      forceEnableStartTab={forceEnableStartTab}
      allowUserInputSelection={allowUserInputSelection}
    />
  )
}

export default memo(ChangeBlock)
