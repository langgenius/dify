import type { BlockSelectorProps } from '@/app/components/workflow/block-selector'
import type { Node, OnSelectBlock } from '@/app/components/workflow/types'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import { memo, useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useStoreApi } from 'reactflow'
import BlockSelector from '@/app/components/workflow/block-selector'
import { BlockEnum } from '@/app/components/workflow/types'
import { FlowType } from '@/types/common'
import { useHooksStore } from '../hooks-store'
import { useAvailableBlocks } from '../hooks/use-available-blocks'
import { useNodesMetaData } from '../hooks/use-nodes-meta-data'
import { usePanelInteractions } from '../hooks/use-panel-interactions'
import { useIsChatMode, useNodesReadOnly } from '../hooks/use-workflow'
import { useWorkflowStore } from '../store'
import {
  generateNewNode,
  getNodeCustomTypeByNodeDataType,
  getNodesWithSameDefaultDataType,
} from '../utils'

type AddBlockProps = {
  renderTrigger?: BlockSelectorProps['trigger']
  sideOffset?: BlockSelectorProps['sideOffset']
  alignOffset?: BlockSelectorProps['alignOffset']
  onClose?: () => void
  isolateKeyboardEvents?: boolean
}
const AddBlock = ({
  renderTrigger,
  sideOffset,
  alignOffset,
  onClose,
  isolateKeyboardEvents,
}: AddBlockProps) => {
  const { t } = useTranslation()
  const store = useStoreApi()
  const workflowStore = useWorkflowStore()
  const isChatMode = useIsChatMode()
  const { nodesReadOnly } = useNodesReadOnly()
  const { handlePaneContextmenuCancel } = usePanelInteractions()
  const [open, setOpen] = useState(false)
  const { availableNextBlocks } = useAvailableBlocks(BlockEnum.Start, false)
  const { nodesMap: nodesMetaDataMap } = useNodesMetaData()
  const flowType = useHooksStore((s) => s.configsMap?.flowType)
  const showStartTab = flowType !== FlowType.ragPipeline && !isChatMode

  const handleOpenChange = useCallback(
    (open: boolean) => {
      setOpen(open)
      if (!open) (onClose ?? handlePaneContextmenuCancel)()
    },
    [handlePaneContextmenuCancel, onClose],
  )

  const handleSelect = useCallback<OnSelectBlock>(
    (type, pluginDefaultValue) => {
      const { getNodes } = store.getState()
      const { defaultValue } = nodesMetaDataMap![type]
      const nodes = getNodes()
      const nodesWithSameType = getNodesWithSameDefaultDataType(nodes, type, defaultValue)
      const { newNode } = generateNewNode({
        type: getNodeCustomTypeByNodeDataType(type),
        data: {
          ...(defaultValue as Node['data']),
          title:
            nodesWithSameType.length > 0
              ? `${defaultValue.title} ${nodesWithSameType.length + 1}`
              : defaultValue.title,
          ...pluginDefaultValue,
          _isCandidate: true,
        },
        position: {
          x: 0,
          y: 0,
        },
      })
      workflowStore.setState({
        candidateNode: newNode,
      })
    },
    [store, workflowStore, nodesMetaDataMap],
  )

  const renderTriggerElement = (
    <IconButton
      aria-label={t(($) => $['common.addBlock'], { ns: 'workflow' })}
      size="lg"
      disabled={nodesReadOnly}
      focusableWhenDisabled
      data-block-selector-open={open ? '' : undefined}
      className="rounded-md data-block-selector-open:bg-state-accent-active data-block-selector-open:text-text-accent"
    >
      <span aria-hidden className="i-ri-add-circle-fill size-4" />
    </IconButton>
  )

  return (
    <BlockSelector
      open={open}
      onOpenChange={handleOpenChange}
      disabled={nodesReadOnly}
      onSelect={handleSelect}
      placement="right-start"
      sideOffset={sideOffset ?? 4}
      alignOffset={alignOffset ?? -8}
      trigger={renderTrigger || renderTriggerElement}
      triggerAriaLabel={t(($) => $['common.addBlock'], { ns: 'workflow' })}
      triggerTooltip={t(($) => $['common.addBlock'], { ns: 'workflow' })}
      popupClassName="min-w-[256px]!"
      availableBlocksTypes={availableNextBlocks}
      showStartTab={showStartTab}
      isolateKeyboardEvents={isolateKeyboardEvents}
    />
  )
}

export default memo(AddBlock)
