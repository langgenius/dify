import type { NodeActionsMenuProps as NodeActionsContentProps } from './types'
import type { Node } from '@/app/components/workflow/types'
import { cn } from '@langgenius/dify-ui/cn'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import {
  Menu,
  MenuGroup,
  MenuItem,
  MenuLinkItem,
  MenuPopup,
  MenuPortal,
  MenuPositioner,
  MenuSeparator,
  MenuTrigger,
} from '@langgenius/dify-ui/menu'
import {
  Popover,
  PopoverBackdrop,
  PopoverPortal,
  PopoverPositioner,
  PopoverTrigger,
} from '@langgenius/dify-ui/popover'
import { useCallback, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useStoreApi } from 'reactflow'
import { handleWorkflowMenuKeyDown } from '../shortcuts/handle-workflow-menu-key-down'
import { ChangeBlockPopup } from './change-block-popup'
import {
  NODE_ACTIONS_MENU_ITEM_WITH_SHORTCUT_CLASS_NAME,
  NODE_ACTIONS_MENU_WIDTH_CLASS_NAME,
  NodeActionsMenuAbout,
  NodeActionsMenuItemContent,
} from './shared'
import { useNodeActionsMenuModel } from './use-node-actions-menu-model'

type NodeActionsMenuProps = {
  id: string
  data: Node['data']
  triggerClassName?: string
  onOpenChange?: (open: boolean) => void
  showHelpLink?: boolean
}

export function NodeActionsMenu({
  id,
  data,
  triggerClassName,
  onOpenChange,
  showHelpLink = true,
}: NodeActionsMenuProps) {
  const { t } = useTranslation(['common'])
  const [open, setOpen] = useState(false)

  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      setOpen(nextOpen)
      onOpenChange?.(nextOpen)
    },
    [onOpenChange],
  )

  const closeMenu = useCallback(() => {
    setOpen(false)
    onOpenChange?.(false)
  }, [onOpenChange])

  return (
    <Menu modal={false} open={open} onOpenChange={handleOpenChange}>
      <MenuTrigger
        render={
          <IconButton
            size="md"
            aria-label={t(($) => $['operation.more'], { ns: 'common' })}
            className={cn('data-popup-open:bg-state-base-hover', triggerClassName)}
          >
            <span aria-hidden className="i-ri-more-fill size-4" />
          </IconButton>
        }
      />
      <MenuPortal>
        <NodeActionsMenuContent
          id={id}
          data={data}
          onClose={closeMenu}
          showHelpLink={showHelpLink}
        />
      </MenuPortal>
    </Menu>
  )
}

function NodeActionsMenuContent(props: NodeActionsContentProps) {
  const { t } = useTranslation(['common', 'workflow', 'workflowDebug'])
  const model = useNodeActionsMenuModel(props)
  const flowStore = useStoreApi()
  const deletingRef = useRef(false)
  const hasRunGroup = model.canRun || model.canChangeBlock
  const hasEditGroup = !model.nodesReadOnly && !model.isSingleton
  const hasDeleteGroup = !model.nodesReadOnly && !model.isUndeletable
  const singleRunActionLabel = model.isSingleRunning
    ? t(($) => $['debug.variableInspect.trigger.stop'], { ns: 'workflowDebug' })
    : t(($) => $['panel.runThisStep'], { ns: 'workflow' })

  function handleDelete() {
    deletingRef.current = true
    model.handleDelete()
  }

  return (
    <MenuPositioner sideOffset={4} align="end">
      <MenuPopup
        finalFocus={() => (deletingRef.current ? (flowStore.getState().domNode ?? true) : true)}
        className={`${NODE_ACTIONS_MENU_WIDTH_CLASS_NAME} border-[0.5px] border-components-panel-border bg-components-panel-bg-blur py-1 shadow-lg backdrop-blur-[5px]`}
        onKeyDown={(event) =>
          handleWorkflowMenuKeyDown(event, [
            ['workflow.copy', hasEditGroup ? model.handleCopy : undefined],
            ['workflow.duplicate', hasEditGroup ? model.handleDuplicate : undefined],
            ['workflow.delete', hasDeleteGroup ? handleDelete : undefined],
          ])
        }
      >
        {hasRunGroup && (
          <MenuGroup>
            {model.canRun && <MenuItem onClick={model.handleRun}>{singleRunActionLabel}</MenuItem>}
            {model.canChangeBlock && (
              <Popover modal="trap-focus">
                <MenuItem
                  closeOnClick={false}
                  // The menu row owns the focus treatment, so the trigger adds no ring.
                  render={
                    <PopoverTrigger
                      nativeButton={false}
                      className="focus-visible:ring-0"
                      render={<div />}
                    />
                  }
                  className="data-popup-open:bg-state-base-hover"
                >
                  {t(($) => $['panel.changeBlock'], { ns: 'workflow' })}
                </MenuItem>
                <PopoverPortal>
                  <PopoverBackdrop />
                  <PopoverPositioner side="right" align="start" positionMethod="fixed">
                    <ChangeBlockPopup
                      nodeId={model.id}
                      nodeData={model.data}
                      sourceHandle={model.sourceHandle}
                      onComplete={props.onClose}
                    />
                  </PopoverPositioner>
                </PopoverPortal>
              </Popover>
            )}
          </MenuGroup>
        )}
        {hasRunGroup &&
          (hasEditGroup || hasDeleteGroup || model.workflowAppHref || model.helpLinkUri) && (
            <MenuSeparator />
          )}
        {hasEditGroup && (
          <MenuGroup>
            <MenuItem
              className={NODE_ACTIONS_MENU_ITEM_WITH_SHORTCUT_CLASS_NAME}
              onClick={model.handleCopy}
            >
              <NodeActionsMenuItemContent shortcut="workflow.copy">
                {t(($) => $['common.copy'], { ns: 'workflow' })}
              </NodeActionsMenuItemContent>
            </MenuItem>
            <MenuItem
              className={NODE_ACTIONS_MENU_ITEM_WITH_SHORTCUT_CLASS_NAME}
              onClick={model.handleDuplicate}
            >
              <NodeActionsMenuItemContent shortcut="workflow.duplicate">
                {t(($) => $['common.duplicate'], { ns: 'workflow' })}
              </NodeActionsMenuItemContent>
            </MenuItem>
          </MenuGroup>
        )}
        {hasEditGroup && (hasDeleteGroup || model.workflowAppHref || model.helpLinkUri) && (
          <MenuSeparator />
        )}
        {hasDeleteGroup && (
          <MenuGroup>
            <MenuItem
              variant="destructive"
              className={NODE_ACTIONS_MENU_ITEM_WITH_SHORTCUT_CLASS_NAME}
              onClick={handleDelete}
            >
              <NodeActionsMenuItemContent shortcut="workflow.delete">
                {t(($) => $['operation.delete'], { ns: 'common' })}
              </NodeActionsMenuItemContent>
            </MenuItem>
          </MenuGroup>
        )}
        {hasDeleteGroup && (model.workflowAppHref || model.helpLinkUri) && <MenuSeparator />}
        {model.workflowAppHref && (
          <MenuGroup>
            <MenuLinkItem href={model.workflowAppHref} target="_blank" rel="noopener noreferrer">
              {t(($) => $['panel.openWorkflow'], { ns: 'workflow' })}
            </MenuLinkItem>
          </MenuGroup>
        )}
        {model.workflowAppHref && model.helpLinkUri && <MenuSeparator />}
        {model.helpLinkUri && (
          <MenuGroup>
            <MenuLinkItem href={model.helpLinkUri} target="_blank" rel="noopener noreferrer">
              {t(($) => $['panel.helpLink'], { ns: 'workflow' })}
            </MenuLinkItem>
          </MenuGroup>
        )}
        <MenuSeparator />
        <NodeActionsMenuAbout
          title={t(($) => $['panel.about'], { ns: 'workflow' })}
          description={model.about.description}
          author={`${t(($) => $['panel.createdBy'], { ns: 'workflow' })} ${model.about.author}`}
        />
      </MenuPopup>
    </MenuPositioner>
  )
}
