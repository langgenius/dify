'use client'

import type { AgentCliTool, AgentTool, ToolSettingTarget } from './types'
import { cn } from '@langgenius/dify-ui/cn'
import { Popover, PopoverContent, PopoverTrigger } from '@langgenius/dify-ui/popover'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useTools } from '@/features/agent-v2/agent-composer/store'
import { ConfigureSectionAddButton } from '../common/add-button'
import { ConfigureSection } from '../common/section'
import { AgentCliToolItem, CliToolDialog } from './cli-tool'
import { AgentProviderToolItem, ProviderToolSettingsDialog } from './provider-tool'

function AgentToolItem({
  tool,
  isExpanded,
  onOpenChange,
  onConfigureAction,
  onDeleteCliTool,
  onEditCliTool,
}: {
  tool: AgentTool
  isExpanded: boolean
  onOpenChange: (open: boolean) => void
  onConfigureAction: (target: ToolSettingTarget) => void
  onDeleteCliTool: (toolId: string) => void
  onEditCliTool: (tool: AgentCliTool) => void
}) {
  if (tool.kind === 'provider')
    return <AgentProviderToolItem tool={tool} isExpanded={isExpanded} onOpenChange={onOpenChange} onConfigureAction={onConfigureAction} />

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
}: {
  onAddCliTool: () => void
}) {
  const { t } = useTranslation('agentV2')
  const [open, setOpen] = useState(false)

  const openCliToolDialog = () => {
    setOpen(false)
    onAddCliTool()
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
          onClick={() => setOpen(false)}
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

export function AgentTools() {
  const { t } = useTranslation('agentV2')
  const [tools, setTools] = useTools()
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
          <AddToolMenu onAddCliTool={openCliToolDialog} />
        )}
      >
        {tools.map(tool => (
          <AgentToolItem
            key={tool.id}
            tool={tool}
            isExpanded={tool.kind === 'provider' && expandedToolIds.has(tool.id)}
            onOpenChange={open => setToolOpen(tool, open)}
            onConfigureAction={setSettingTarget}
            onDeleteCliTool={toolId => setTools(tools.filter(tool => tool.id !== toolId))}
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
