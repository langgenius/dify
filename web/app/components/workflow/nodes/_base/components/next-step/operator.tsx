import type { CommonNodeType, OnSelectBlock } from '@/app/components/workflow/types'
import { Button } from '@langgenius/dify-ui/button'
import {
  DropdownMenu,
  DropdownMenuPopup,
  DropdownMenuPortal,
  DropdownMenuPositioner,
  DropdownMenuTrigger,
} from '@langgenius/dify-ui/dropdown-menu'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import { intersection } from 'es-toolkit/array'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import BlockSelector from '@/app/components/workflow/block-selector'
import { getNodeCatalogType } from '@/app/components/workflow/utils'
import { useAvailableBlocks } from '../../../../hooks/use-available-blocks'
import { useNodesInteractions } from '../../../../hooks/use-nodes-interactions'

type ChangeItemProps = {
  data: CommonNodeType
  nodeId: string
  sourceHandle: string
}
const ChangeItem = ({ data, nodeId, sourceHandle }: ChangeItemProps) => {
  const { t } = useTranslation()

  const { handleNodeChange } = useNodesInteractions()
  const nodeCatalogType = getNodeCatalogType(data)
  const { availablePrevBlocks, availableNextBlocks } = useAvailableBlocks(
    nodeCatalogType,
    data.isInIteration || data.isInLoop,
  )

  const handleSelect = useCallback<OnSelectBlock>(
    (type, pluginDefaultValue) => {
      handleNodeChange(nodeId, type, sourceHandle, pluginDefaultValue)
    },
    [nodeId, sourceHandle, handleNodeChange],
  )

  const triggerElement = (
    <Button variant="ghost" size="medium" className="w-full justify-start px-2">
      {t(($) => $['panel.change'], { ns: 'workflow' })}
    </Button>
  )

  return (
    <BlockSelector
      onSelect={handleSelect}
      placement="top-end"
      sideOffset={6}
      alignOffset={8}
      trigger={triggerElement}
      popupClassName="w-[328px]!"
      availableBlocksTypes={intersection(availablePrevBlocks, availableNextBlocks).filter(
        (item) => item !== nodeCatalogType,
      )}
    />
  )
}

type OperatorProps = {
  open: boolean
  onOpenChange: (v: boolean) => void
  data: CommonNodeType
  nodeId: string
  sourceHandle: string
}
const Operator = ({ open, onOpenChange, data, nodeId, sourceHandle }: OperatorProps) => {
  const { t } = useTranslation()
  const { handleNodeDelete, handleNodeDisconnect } = useNodesInteractions()

  return (
    <DropdownMenu open={open} onOpenChange={onOpenChange}>
      <DropdownMenuTrigger
        render={
          <IconButton
            variant="secondary"
            size="md"
            className="rounded-lg"
            aria-label={t(($) => $['common.moreActions'], { ns: 'workflow' })}
          >
            <span aria-hidden className="i-ri-more-fill size-4" />
          </IconButton>
        }
      />
      <DropdownMenuPortal>
        <DropdownMenuPositioner placement="bottom-end" sideOffset={4} alignOffset={-4}>
          <DropdownMenuPopup>
            <div className="min-w-30 rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-bg-blur system-md-regular text-text-secondary shadow-lg">
              <div className="p-1">
                <ChangeItem data={data} nodeId={nodeId} sourceHandle={sourceHandle} />
                <div
                  className="flex h-8 cursor-pointer items-center rounded-lg px-2 hover:bg-state-base-hover"
                  onClick={() => {
                    onOpenChange(false)
                    handleNodeDisconnect(nodeId)
                  }}
                >
                  {t(($) => $['common.disconnect'], { ns: 'workflow' })}
                </div>
              </div>
              <div className="p-1">
                <div
                  className="flex h-8 cursor-pointer items-center rounded-lg px-2 hover:bg-state-base-hover"
                  onClick={() => {
                    onOpenChange(false)
                    handleNodeDelete(nodeId)
                  }}
                >
                  {t(($) => $['operation.delete'], { ns: 'common' })}
                </div>
              </div>
            </div>
          </DropdownMenuPopup>
        </DropdownMenuPositioner>
      </DropdownMenuPortal>
    </DropdownMenu>
  )
}

export default Operator
