'use client'

import type { AgentCliTool, AgentTool, ToolSettingTarget } from './types'
import type { ToolDefaultValue, ToolValue } from '@/app/components/workflow/block-selector/types'
import { cn } from '@langgenius/dify-ui/cn'
import { Popover, PopoverContent, PopoverTrigger } from '@langgenius/dify-ui/popover'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import ToolPicker from '@/app/components/workflow/block-selector/tool-picker'
import { useRemoveProviderTool, useRemoveProviderToolAction, useTools } from '@/features/agent-v2/agent-composer/store'
import { ConfigureSectionAddButton } from '../common/add-button'
import { ConfigureSectionEmpty } from '../common/empty'
import { ConfigureSection } from '../common/section'
import { CliToolDialog } from './cli-tool/dialog'
import { AgentCliToolItem } from './cli-tool/item'
import { AgentProviderToolItem, ProviderToolSettingsDialog } from './provider-tool'

function AgentToolItem({
  tool,
  isExpanded,
  onOpenChange,
  onConfigureAction,
  onDeleteCliTool,
  onDeleteProviderTool,
  onDeleteProviderToolAction,
  onEditCliTool,
}: {
  tool: AgentTool
  isExpanded: boolean
  onOpenChange: (open: boolean) => void
  onConfigureAction: (target: ToolSettingTarget) => void
  onDeleteCliTool: (toolId: string) => void
  onDeleteProviderTool: (toolId: string) => void
  onDeleteProviderToolAction: (toolId: string, actionId: string) => void
  onEditCliTool: (tool: AgentCliTool) => void
}) {
  if (tool.kind === 'provider') {
    return (
      <AgentProviderToolItem
        tool={tool}
        isExpanded={isExpanded}
        onOpenChange={onOpenChange}
        onConfigureAction={onConfigureAction}
        onRemoveAction={actionId => onDeleteProviderToolAction(tool.id, actionId)}
        onRemoveProvider={() => onDeleteProviderTool(tool.id)}
      />
    )
  }

  return (
    <AgentCliToolItem
      tool={tool}
      onDelete={() => onDeleteCliTool(tool.id)}
      onEdit={() => onEditCliTool(tool)}
    />
  )
}

function AddToolMenuItem({
  badge,
  description,
  iconClassName,
  label,
  onClick,
}: {
  badge?: string
  description: string
  iconClassName: string
  label: string
  onClick?: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-start gap-2 rounded-lg py-2 pr-3 pl-2 text-left hover:bg-state-base-hover focus-visible:bg-state-base-hover focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden"
    >
      <span aria-hidden className={cn('mt-0.5 size-4 shrink-0 text-text-secondary', iconClassName)} />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex min-w-0 items-center gap-1">
          <span className="truncate system-sm-semibold text-text-secondary">
            {label}
          </span>
          {badge && (
            <span className="shrink-0 rounded-[5px] border border-divider-deep bg-components-badge-bg-dimm px-1 py-0.5 system-2xs-medium-uppercase text-text-tertiary">
              {badge}
            </span>
          )}
        </span>
        <span className="system-xs-regular text-text-tertiary">
          {description}
        </span>
      </span>
    </button>
  )
}

function AddToolMenu({
  onAddCliTool,
  onAddTools,
  selectedTools,
}: {
  onAddCliTool: () => void
  onAddTools: (tools: ToolDefaultValue[]) => void
  selectedTools: ToolValue[]
}) {
  const { t } = useTranslation('agentV2')
  const [open, setOpen] = useState(false)
  const [isToolPickerOpen, setIsToolPickerOpen] = useState(false)

  const openToolPicker = () => {
    setOpen(false)
    setIsToolPickerOpen(true)
  }

  const openCliToolDialog = () => {
    setOpen(false)
    onAddCliTool()
  }

  if (isToolPickerOpen) {
    return (
      <ToolPicker
        trigger={<ConfigureSectionAddButton ariaLabel={t('agentDetail.configure.tools.add')} />}
        placement="bottom-end"
        offset={4}
        panelClassName="w-[400px] overflow-hidden"
        isShow={isToolPickerOpen}
        onShowChange={setIsToolPickerOpen}
        disabled={false}
        supportAddCustomTool
        selectedTools={selectedTools}
        onSelect={tool => onAddTools([tool])}
        onSelectMultiple={onAddTools}
      />
    )
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={(
          <ConfigureSectionAddButton ariaLabel={t('agentDetail.configure.tools.add')} />
        )}
      />
      <PopoverContent
        placement="bottom-end"
        sideOffset={4}
        popupClassName="w-[280px] p-1 backdrop-blur-[5px] bg-components-panel-bg-blur shadow-lg"
      >
        <AddToolMenuItem
          iconClassName="i-ri-box-3-line"
          label={t('agentDetail.configure.tools.addMenu.tool.label')}
          description={t('agentDetail.configure.tools.addMenu.tool.description')}
          onClick={openToolPicker}
        />
        <AddToolMenuItem
          iconClassName="i-ri-terminal-box-line"
          label={t('agentDetail.configure.tools.addMenu.cliTool.label')}
          badge={t('agentDetail.configure.tools.addMenu.cliTool.badge')}
          description={t('agentDetail.configure.tools.addMenu.cliTool.description')}
          onClick={openCliToolDialog}
        />
      </PopoverContent>
    </Popover>
  )
}

const toSelectedToolValue = (tool: AgentTool): ToolValue[] => {
  if (tool.kind !== 'provider')
    return []

  return tool.actions.map(action => ({
    provider_name: tool.id,
    tool_name: action.toolName,
    tool_label: action.name,
    tool_description: action.description,
  }))
}

const toProviderToolAction = (tool: ToolDefaultValue) => ({
  id: `${tool.provider_id}:${tool.tool_name}`,
  name: tool.tool_label || tool.title || tool.tool_name,
  toolName: tool.tool_name,
  description: tool.tool_description || '',
})

const getCredentialVariant = (tool: ToolDefaultValue) =>
  tool.is_team_authorization ? 'authorized' as const : 'endUser' as const

const addProviderTools = (
  currentTools: AgentTool[],
  selectedTools: ToolDefaultValue[],
): AgentTool[] => {
  if (selectedTools.length === 0)
    return currentTools

  const nextTools = [...currentTools]

  selectedTools.forEach((selectedTool) => {
    const action = toProviderToolAction(selectedTool)
    const existingToolIndex = nextTools.findIndex(tool => tool.kind === 'provider' && tool.id === selectedTool.provider_id)
    const existingTool = nextTools[existingToolIndex]

    if (existingTool?.kind === 'provider') {
      if (existingTool.actions.some(existingAction => existingAction.toolName === action.toolName))
        return

      nextTools[existingToolIndex] = {
        ...existingTool,
        actions: [...existingTool.actions, action],
      }
      return
    }

    nextTools.push({
      id: selectedTool.provider_id,
      name: selectedTool.provider_name,
      kind: 'provider',
      iconClassName: 'i-custom-public-other-default-tool-icon text-text-tertiary',
      providerType: selectedTool.provider_type,
      credentialKey: selectedTool.is_team_authorization
        ? 'agentDetail.configure.tools.credential.authOne'
        : 'agentDetail.configure.tools.credential.endUserOAuth',
      credentialVariant: getCredentialVariant(selectedTool),
      actions: [action],
    })
  })

  return nextTools
}

export function AgentTools() {
  const { t } = useTranslation('agentV2')
  const [tools, setTools] = useTools()
  const removeProviderTool = useRemoveProviderTool()
  const removeProviderToolAction = useRemoveProviderToolAction()
  const [expandedToolIds, setExpandedToolIds] = useState<Set<string>>(() => new Set())
  const [settingTarget, setSettingTarget] = useState<ToolSettingTarget | null>(null)
  const [isCliToolDialogOpen, setIsCliToolDialogOpen] = useState(false)
  const [editingCliTool, setEditingCliTool] = useState<AgentCliTool | null>(null)
  const toolsTip = t('agentDetail.configure.tools.tip')
  const toolsListId = 'agent-configure-tools-list'
  const setToolOpen = (tool: AgentTool, open: boolean) => {
    if (tool.kind === 'cli')
      return

    setExpandedToolIds((currentIds) => {
      const nextIds = new Set(currentIds)
      if (open)
        nextIds.add(tool.id)
      else
        nextIds.delete(tool.id)

      return nextIds
    })
  }
  const openCliToolDialog = () => {
    setEditingCliTool(null)
    setIsCliToolDialogOpen(true)
  }
  const updateCliTool = (nextTool: AgentCliTool) => {
    setTools(tools.map(tool => tool.id === nextTool.id ? nextTool : tool))
  }
  const handleCliDialogSave = (tool: AgentCliTool) => {
    if (editingCliTool)
      updateCliTool(tool)
    else
      setTools([...tools, tool])

    setEditingCliTool(null)
  }
  const handleCliDialogOpenChange = (open: boolean) => {
    if (!open)
      setEditingCliTool(null)

    setIsCliToolDialogOpen(open)
  }
  const closeSettingTargetIfRemoved = (toolId: string, actionId?: string) => {
    setSettingTarget((target) => {
      if (!target || target.tool.id !== toolId)
        return target
      if (actionId && target.action.id !== actionId)
        return target

      return null
    })
  }
  const deleteProviderTool = (toolId: string) => {
    setExpandedToolIds((currentIds) => {
      const nextIds = new Set(currentIds)
      nextIds.delete(toolId)
      return nextIds
    })
    closeSettingTargetIfRemoved(toolId)
    removeProviderTool(toolId)
  }
  const deleteProviderToolAction = (toolId: string, actionId: string) => {
    closeSettingTargetIfRemoved(toolId, actionId)
    removeProviderToolAction(toolId, actionId)
  }
  const selectedTools = tools.flatMap(toSelectedToolValue)

  return (
    <>
      <ConfigureSection
        label={t('agentDetail.configure.tools.label')}
        labelId="agent-configure-tools-label"
        panelId={toolsListId}
        tip={toolsTip}
        tipAriaLabel={toolsTip}
        rootClassName="border-b border-divider-subtle pt-4"
        panelContentClassName="flex flex-col gap-1 pb-4"
        actions={(
          <AddToolMenu
            onAddCliTool={openCliToolDialog}
            onAddTools={selectedTools => setTools(addProviderTools(tools, selectedTools))}
            selectedTools={selectedTools}
          />
        )}
      >
        {tools.length === 0
          ? (
              <ConfigureSectionEmpty
                title={t('agentDetail.configure.tools.empty.title')}
                description={t('agentDetail.configure.tools.empty.description')}
              />
            )
          : tools.map(tool => (
              <AgentToolItem
                key={tool.id}
                tool={tool}
                isExpanded={tool.kind === 'provider' && expandedToolIds.has(tool.id)}
                onOpenChange={open => setToolOpen(tool, open)}
                onConfigureAction={setSettingTarget}
                onDeleteCliTool={toolId => setTools(tools.filter(tool => tool.id !== toolId))}
                onDeleteProviderTool={deleteProviderTool}
                onDeleteProviderToolAction={deleteProviderToolAction}
                onEditCliTool={(tool) => {
                  setEditingCliTool(tool)
                  setIsCliToolDialogOpen(true)
                }}
              />
            ))}
      </ConfigureSection>
      <ProviderToolSettingsDialog
        settingTarget={settingTarget}
        onClose={() => setSettingTarget(null)}
      />
      <CliToolDialog
        key={`${editingCliTool?.id ?? 'add'}:${isCliToolDialogOpen ? 'open' : 'closed'}`}
        mode={editingCliTool ? 'edit' : 'add'}
        tool={editingCliTool}
        onSaveCliTool={handleCliDialogSave}
        open={isCliToolDialogOpen}
        onOpenChange={handleCliDialogOpenChange}
      />
    </>
  )
}
