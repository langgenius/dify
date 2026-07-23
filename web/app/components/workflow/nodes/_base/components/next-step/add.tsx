import type { CommonNodeType, OnSelectBlock } from '@/app/components/workflow/types'
import { Button } from '@langgenius/dify-ui/button'
import { RiAddLine } from '@remixicon/react'
import { memo, useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import BlockSelector from '@/app/components/workflow/block-selector'
import {
  useAvailableBlocks,
  useNodesInteractions,
  useNodesReadOnly,
} from '@/app/components/workflow/hooks'
import { getNodeCatalogType } from '@/app/components/workflow/utils'

type AddProps = {
  nodeId: string
  nodeData: CommonNodeType
  sourceHandle: string
  isParallel?: boolean
  isFailBranch?: boolean
}
const Add = ({ nodeId, nodeData, sourceHandle, isParallel, isFailBranch }: AddProps) => {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const { handleNodeAdd } = useNodesInteractions()
  const { nodesReadOnly } = useNodesReadOnly()
  const { availableNextBlocks } = useAvailableBlocks(
    getNodeCatalogType(nodeData),
    nodeData.isInIteration || nodeData.isInLoop,
  )

  const handleSelect = useCallback<OnSelectBlock>(
    (type, pluginDefaultValue) => {
      handleNodeAdd(
        {
          nodeType: type,
          pluginDefaultValue,
        },
        {
          prevNodeId: nodeId,
          prevNodeSourceHandle: sourceHandle,
        },
      )
    },
    [handleNodeAdd],
  )

  const handleOpenChange = useCallback((newOpen: boolean) => {
    setOpen(newOpen)
  }, [])

  const tip = useMemo(() => {
    if (isFailBranch) return t(($) => $['common.addFailureBranch'], { ns: 'workflow' })

    if (isParallel) return t(($) => $['common.addParallelNode'], { ns: 'workflow' })

    return t(($) => $['panel.selectNextStep'], { ns: 'workflow' })
  }, [isFailBranch, isParallel, t])
  const renderTrigger = useCallback(
    (open: boolean) => {
      return (
        <Button
          variant="ghost"
          size="large"
          className={`bg-dropzone-bg hover:bg-dropzone-bg-hover relative w-full justify-start rounded-lg border border-dashed border-divider-regular px-2 text-xs text-text-placeholder ${open && 'bg-components-dropzone-bg-alt!'} `}
        >
          <div className="mr-1.5 flex h-5 w-5 items-center justify-center rounded-[5px] bg-background-default-dimmed">
            <RiAddLine aria-hidden className="size-3" />
          </div>
          <div className="flex items-center uppercase">{tip}</div>
        </Button>
      )
    },
    [nodesReadOnly, tip],
  )

  return (
    <BlockSelector
      open={open}
      onOpenChange={handleOpenChange}
      disabled={nodesReadOnly}
      onSelect={handleSelect}
      snippetInsertPayload={{
        prevNodeId: nodeId,
        prevNodeSourceHandle: sourceHandle,
      }}
      placement="top"
      sideOffset={0}
      trigger={renderTrigger}
      popupClassName="w-[328px]!"
      availableBlocksTypes={availableNextBlocks}
    />
  )
}

export default memo(Add)
