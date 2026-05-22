import type { NodeActionsMenuProps } from './types'
import {
  ContextMenuGroup,
  ContextMenuItem,
  ContextMenuLinkItem,
  ContextMenuSeparator,
} from '@langgenius/dify-ui/context-menu'
import { useTranslation } from 'react-i18next'
import { ChangeBlockMenuTrigger } from './change-block-menu-trigger'
import {
  NODE_ACTIONS_MENU_DELETE_ITEM_CLASS_NAME,
  NODE_ACTIONS_MENU_ITEM_WITH_SHORTCUT_CLASS_NAME,
  NodeActionsMenuAbout,
  NodeActionsMenuItemContent,
} from './shared'
import { useNodeActionsMenuModel } from './use-node-actions-menu-model'

export function NodeActionsContextMenuContent(props: NodeActionsMenuProps) {
  const { t } = useTranslation()
  const model = useNodeActionsMenuModel(props)
  const hasRunGroup = model.canRun || model.canChangeBlock
  const hasEditGroup = !model.nodesReadOnly && !model.isSingleton
  const hasDeleteGroup = !model.nodesReadOnly && !model.isUndeletable

  return (
    <>
      {hasRunGroup && (
        <ContextMenuGroup>
          {model.canRun && (
            <ContextMenuItem onClick={model.handleRun}>
              {t('panel.runThisStep', { ns: 'workflow' })}
            </ContextMenuItem>
          )}
          {model.canChangeBlock && (
            <ChangeBlockMenuTrigger
              nodeId={model.id}
              nodeData={model.data}
              sourceHandle={model.sourceHandle}
            />
          )}
        </ContextMenuGroup>
      )}
      {hasRunGroup && (hasEditGroup || hasDeleteGroup || model.workflowAppHref || model.helpLinkUri) && <ContextMenuSeparator />}
      {hasEditGroup && (
        <ContextMenuGroup>
          <ContextMenuItem
            className={NODE_ACTIONS_MENU_ITEM_WITH_SHORTCUT_CLASS_NAME}
            onClick={model.handleCopy}
          >
            <NodeActionsMenuItemContent shortcut="workflow.copy">
              {t('common.copy', { ns: 'workflow' })}
            </NodeActionsMenuItemContent>
          </ContextMenuItem>
          <ContextMenuItem
            className={NODE_ACTIONS_MENU_ITEM_WITH_SHORTCUT_CLASS_NAME}
            onClick={model.handleDuplicate}
          >
            <NodeActionsMenuItemContent shortcut="workflow.duplicate">
              {t('common.duplicate', { ns: 'workflow' })}
            </NodeActionsMenuItemContent>
          </ContextMenuItem>
        </ContextMenuGroup>
      )}
      {hasEditGroup && (hasDeleteGroup || model.workflowAppHref || model.helpLinkUri) && <ContextMenuSeparator />}
      {hasDeleteGroup && (
        <ContextMenuGroup>
          <ContextMenuItem
            className={NODE_ACTIONS_MENU_DELETE_ITEM_CLASS_NAME}
            onClick={model.handleDelete}
          >
            <NodeActionsMenuItemContent shortcut="workflow.delete">
              {t('operation.delete', { ns: 'common' })}
            </NodeActionsMenuItemContent>
          </ContextMenuItem>
        </ContextMenuGroup>
      )}
      {hasDeleteGroup && (model.workflowAppHref || model.helpLinkUri) && <ContextMenuSeparator />}
      {model.workflowAppHref && (
        <ContextMenuGroup>
          <ContextMenuLinkItem href={model.workflowAppHref} target="_blank" rel="noopener noreferrer">
            {t('panel.openWorkflow', { ns: 'workflow' })}
          </ContextMenuLinkItem>
        </ContextMenuGroup>
      )}
      {model.workflowAppHref && model.helpLinkUri && <ContextMenuSeparator />}
      {model.helpLinkUri && (
        <ContextMenuGroup>
          <ContextMenuLinkItem href={model.helpLinkUri} target="_blank" rel="noopener noreferrer">
            {t('panel.helpLink', { ns: 'workflow' })}
          </ContextMenuLinkItem>
        </ContextMenuGroup>
      )}
      <ContextMenuSeparator />
      <NodeActionsMenuAbout
        title={t('panel.about', { ns: 'workflow' })}
        description={model.about.description}
        author={`${t('panel.createdBy', { ns: 'workflow' })} ${model.about.author}`}
      />
    </>
  )
}
