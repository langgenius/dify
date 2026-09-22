import type { NodeActionsMenuProps } from './types'
import {
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLinkItem,
  DropdownMenuSeparator,
} from '@langgenius/dify-ui/dropdown-menu'
import {
  Popover,
  PopoverBackdrop,
  PopoverPortal,
  PopoverPositioner,
  PopoverTrigger,
} from '@langgenius/dify-ui/popover'
import { useTranslation } from 'react-i18next'
import { ChangeBlockPopup } from './change-block-popup'
import {
  NODE_ACTIONS_MENU_DELETE_ITEM_CLASS_NAME,
  NODE_ACTIONS_MENU_ITEM_WITH_SHORTCUT_CLASS_NAME,
  NodeActionsMenuAbout,
  NodeActionsMenuItemContent,
} from './shared'
import { useNodeActionsMenuModel } from './use-node-actions-menu-model'

export function NodeActionsDropdownContent(props: NodeActionsMenuProps) {
  const { t } = useTranslation()
  const model = useNodeActionsMenuModel(props)
  const hasRunGroup = model.canRun || model.canChangeBlock
  const hasEditGroup = !model.nodesReadOnly && !model.isSingleton
  const hasDeleteGroup = !model.nodesReadOnly && !model.isUndeletable
  const singleRunActionLabel = model.isSingleRunning
    ? t(($) => $['debug.variableInspect.trigger.stop'], { ns: 'workflow' })
    : t(($) => $['panel.runThisStep'], { ns: 'workflow' })

  return (
    <>
      {hasRunGroup && (
        <DropdownMenuGroup>
          {model.canRun && (
            <DropdownMenuItem onClick={model.handleRun}>{singleRunActionLabel}</DropdownMenuItem>
          )}
          {model.canChangeBlock && (
            <Popover modal="trap-focus">
              <DropdownMenuItem
                closeOnClick={false}
                render={<PopoverTrigger nativeButton={false} render={<div />} />}
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
            className={NODE_ACTIONS_MENU_DELETE_ITEM_CLASS_NAME}
            onClick={model.handleDelete}
          >
            <NodeActionsMenuItemContent shortcut="workflow.delete">
              {t(($) => $['operation.delete'], { ns: 'common' })}
            </NodeActionsMenuItemContent>
          </DropdownMenuItem>
        </DropdownMenuGroup>
      )}
      {hasDeleteGroup && (model.workflowAppHref || model.helpLinkUri) && <DropdownMenuSeparator />}
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
          <DropdownMenuLinkItem href={model.helpLinkUri} target="_blank" rel="noopener noreferrer">
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
    </>
  )
}
