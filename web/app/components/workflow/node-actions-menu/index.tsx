import type { NodeActionsMenuProps } from './types'
import type { Node } from '@/app/components/workflow/types'
import { cn } from '@langgenius/dify-ui/cn'
import {
  DropdownMenu,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLinkItem,
  DropdownMenuPopup,
  DropdownMenuPortal,
  DropdownMenuPositioner,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@langgenius/dify-ui/dropdown-menu'
import { IconButton } from '@langgenius/dify-ui/icon-button'
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

type NodeActionsDropdownProps = {
  id: string
  data: Node['data']
  triggerClassName?: string
  onOpenChange?: (open: boolean) => void
  showHelpLink?: boolean
}

export function NodeActionsDropdown({
  id,
  data,
  triggerClassName,
  onOpenChange,
  showHelpLink = true,
}: NodeActionsDropdownProps) {
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
    <DropdownMenu modal={false} open={open} onOpenChange={handleOpenChange}>
      <DropdownMenuTrigger
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
      <DropdownMenuPortal>
        <NodeActionsDropdownContent
          id={id}
          data={data}
          onClose={closeMenu}
          showHelpLink={showHelpLink}
        />
      </DropdownMenuPortal>
    </DropdownMenu>
  )
}

function NodeActionsDropdownContent(props: NodeActionsMenuProps) {
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
    <DropdownMenuPositioner placement="bottom-end">
      <DropdownMenuPopup
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
          <DropdownMenuGroup>
            {model.canRun && (
              <DropdownMenuItem onClick={model.handleRun}>{singleRunActionLabel}</DropdownMenuItem>
            )}
            {model.canChangeBlock && (
              <Popover modal="trap-focus">
                <DropdownMenuItem
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
                </DropdownMenuItem>
                <PopoverPortal>
                  <PopoverBackdrop />
                  <PopoverPositioner placement="right-start" positionMethod="fixed">
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
          </DropdownMenuGroup>
        )}
        {hasRunGroup &&
          (hasEditGroup || hasDeleteGroup || model.workflowAppHref || model.helpLinkUri) && (
            <DropdownMenuSeparator />
          )}
        {hasEditGroup && (
          <DropdownMenuGroup>
            <DropdownMenuItem
              className={NODE_ACTIONS_MENU_ITEM_WITH_SHORTCUT_CLASS_NAME}
              onClick={model.handleCopy}
            >
              <NodeActionsMenuItemContent shortcut="workflow.copy">
                {t(($) => $['common.copy'], { ns: 'workflow' })}
              </NodeActionsMenuItemContent>
            </DropdownMenuItem>
            <DropdownMenuItem
              className={NODE_ACTIONS_MENU_ITEM_WITH_SHORTCUT_CLASS_NAME}
              onClick={model.handleDuplicate}
            >
              <NodeActionsMenuItemContent shortcut="workflow.duplicate">
                {t(($) => $['common.duplicate'], { ns: 'workflow' })}
              </NodeActionsMenuItemContent>
            </DropdownMenuItem>
          </DropdownMenuGroup>
        )}
        {hasEditGroup && (hasDeleteGroup || model.workflowAppHref || model.helpLinkUri) && (
          <DropdownMenuSeparator />
        )}
        {hasDeleteGroup && (
          <DropdownMenuGroup>
            <DropdownMenuItem
              variant="destructive"
              className={NODE_ACTIONS_MENU_ITEM_WITH_SHORTCUT_CLASS_NAME}
              onClick={handleDelete}
            >
              <NodeActionsMenuItemContent shortcut="workflow.delete">
                {t(($) => $['operation.delete'], { ns: 'common' })}
              </NodeActionsMenuItemContent>
            </DropdownMenuItem>
          </DropdownMenuGroup>
        )}
        {hasDeleteGroup && (model.workflowAppHref || model.helpLinkUri) && (
          <DropdownMenuSeparator />
        )}
        {model.workflowAppHref && (
          <DropdownMenuGroup>
            <DropdownMenuLinkItem
              href={model.workflowAppHref}
              target="_blank"
              rel="noopener noreferrer"
            >
              {t(($) => $['panel.openWorkflow'], { ns: 'workflow' })}
            </DropdownMenuLinkItem>
          </DropdownMenuGroup>
        )}
        {model.workflowAppHref && model.helpLinkUri && <DropdownMenuSeparator />}
        {model.helpLinkUri && (
          <DropdownMenuGroup>
            <DropdownMenuLinkItem
              href={model.helpLinkUri}
              target="_blank"
              rel="noopener noreferrer"
            >
              {t(($) => $['panel.helpLink'], { ns: 'workflow' })}
            </DropdownMenuLinkItem>
          </DropdownMenuGroup>
        )}
        <DropdownMenuSeparator />
        <NodeActionsMenuAbout
          title={t(($) => $['panel.about'], { ns: 'workflow' })}
          description={model.about.description}
          author={`${t(($) => $['panel.createdBy'], { ns: 'workflow' })} ${model.about.author}`}
        />
      </DropdownMenuPopup>
    </DropdownMenuPositioner>
  )
}
