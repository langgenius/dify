import type { CommonNodeType, OnSelectBlock } from '@/app/components/workflow/types'
import { buttonVariants } from '@langgenius/dify-ui/button'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import {
  Menu,
  MenuItem,
  MenuPopup,
  MenuPortal,
  MenuPositioner,
  MenuTrigger,
} from '@langgenius/dify-ui/menu'
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
  const { t } = useTranslation(['workflow'])

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
    <MenuItem
      nativeButton
      render={<button type="button" />}
      closeOnClick={false}
      className={buttonVariants({
        variant: 'ghost',
        size: 'medium',
        className:
          'w-[calc(100%-8px)] justify-start px-2 data-highlighted:bg-components-button-ghost-bg-hover',
      })}
    >
      {t(($) => $['panel.change'], { ns: 'workflow' })}
    </MenuItem>
  )

  return (
    <BlockSelector
      onSelect={handleSelect}
      side="top"
      align="end"
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
  const { t } = useTranslation(['common', 'workflow'])
  const { handleNodeDelete, handleNodeDisconnect } = useNodesInteractions()

  return (
    <Menu open={open} onOpenChange={onOpenChange}>
      <MenuTrigger
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
      <MenuPortal>
        <MenuPositioner sideOffset={4} align="end" alignOffset={-4}>
          <MenuPopup>
            <div className="min-w-30 rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-bg-blur system-md-regular text-text-secondary shadow-lg">
              <div className="py-1">
                <ChangeItem data={data} nodeId={nodeId} sourceHandle={sourceHandle} />
                <MenuItem
                  onClick={() => {
                    onOpenChange(false)
                    handleNodeDisconnect(nodeId)
                  }}
                >
                  {t(($) => $['common.disconnect'], { ns: 'workflow' })}
                </MenuItem>
              </div>
              <div className="py-1">
                <MenuItem
                  onClick={() => {
                    onOpenChange(false)
                    handleNodeDelete(nodeId)
                  }}
                >
                  {t(($) => $['operation.delete'], { ns: 'common' })}
                </MenuItem>
              </div>
            </div>
          </MenuPopup>
        </MenuPositioner>
      </MenuPortal>
    </Menu>
  )
}

export default Operator
