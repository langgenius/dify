'use client'

import type { AgentOrchestrateAddActionOptions } from '../add-actions-context'
import type { AgentCliTool, AgentTool, ToolSettingTarget } from './types'
import type { ToolDefaultValue, ToolValue } from '@/app/components/workflow/block-selector/types'
import { cn } from '@langgenius/dify-ui/cn'
import { Popover, PopoverContent, PopoverTrigger } from '@langgenius/dify-ui/popover'
import { useCallback, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import ToolPicker from '@/app/components/workflow/block-selector/tool-picker'
import { useRegisterAgentOrchestrateAddAction } from '../add-actions-context'
import { ConfigureSectionAddButton } from '../common/add-button'
import { ConfigureSectionEmpty } from '../common/empty'
import { ConfigureSection } from '../common/section'
import { CliToolDialog } from './cli-tool/dialog'
import { AgentCliToolItem } from './cli-tool/item'
import { useAgentToolsOperations } from './hooks'
import { ProviderToolSettingsDialog } from './provider-tool/dialog'
import { AgentProviderToolItem } from './provider-tool/item'

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
  onOpenChange: (tool: AgentTool, open: boolean) => void
  onConfigureAction: (target: ToolSettingTarget) => void
  onDeleteCliTool: (toolId: string) => void
  onDeleteProviderTool: (toolId: string) => void
  onDeleteProviderToolAction: (toolId: string, actionId: string) => void
  onEditCliTool: (tool: AgentCliTool) => void
}) {
  const handleOpenChange = useCallback((open: boolean) => {
    onOpenChange(tool, open)
  }, [onOpenChange, tool])

  const handleRemoveProvider = useCallback(() => {
    onDeleteProviderTool(tool.id)
  }, [onDeleteProviderTool, tool.id])

  const handleRemoveProviderAction = useCallback((actionId: string) => {
    onDeleteProviderToolAction(tool.id, actionId)
  }, [onDeleteProviderToolAction, tool.id])

  const handleDeleteCliTool = useCallback(() => {
    onDeleteCliTool(tool.id)
  }, [onDeleteCliTool, tool.id])

  const handleEditCliTool = useCallback(() => {
    if (tool.kind === 'cli')
      onEditCliTool(tool)
  }, [onEditCliTool, tool])

  if (tool.kind === 'provider') {
    return (
      <AgentProviderToolItem
        tool={tool}
        isExpanded={isExpanded}
        onOpenChange={handleOpenChange}
        onConfigureAction={onConfigureAction}
        onRemoveAction={handleRemoveProviderAction}
        onRemoveProvider={handleRemoveProvider}
      />
    )
  }

  return (
    <AgentCliToolItem
      tool={tool}
      onDelete={handleDeleteCliTool}
      onEdit={handleEditCliTool}
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

  const openToolPicker = useCallback(() => {
    setOpen(false)
    setIsToolPickerOpen(true)
  }, [])

  const openCliToolDialog = useCallback(() => {
    setOpen(false)
    onAddCliTool()
  }, [onAddCliTool])

  const handleSelectTool = useCallback((tool: ToolDefaultValue) => {
    onAddTools([tool])
  }, [onAddTools])

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
        onSelect={handleSelectTool}
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

export function AgentTools() {
  const { t } = useTranslation('agentV2')
  const {
    tools,
    selectedTools,
    expandedToolIds,
    settingTarget,
    isCliToolDialogOpen,
    editingCliTool,
    setToolOpen,
    setSettingTarget,
    addTools,
    deleteCliTool,
    deleteProviderTool,
    deleteProviderToolAction,
    openCliToolDialog,
    editCliTool,
    handleCliDialogSave,
    handleCliDialogOpenChange,
    closeProviderSettingsDialog,
  } = useAgentToolsOperations()
  const promptAddCallbackRef = useRef<AgentOrchestrateAddActionOptions['onAdded']>(undefined)
  const openCliToolDialogFromPrompt = useCallback((options?: AgentOrchestrateAddActionOptions) => {
    promptAddCallbackRef.current = options?.onAdded
    openCliToolDialog()
  }, [openCliToolDialog])
  const handleCliDialogSaveWithPromptInsert = useCallback((tool: AgentCliTool) => {
    handleCliDialogSave(tool)
    if (!editingCliTool) {
      promptAddCallbackRef.current?.(tool)
      promptAddCallbackRef.current = undefined
    }
  }, [editingCliTool, handleCliDialogSave])
  const handleCliDialogOpenChangeWithPromptInsert = useCallback((open: boolean) => {
    if (!open)
      promptAddCallbackRef.current = undefined
    handleCliDialogOpenChange(open)
  }, [handleCliDialogOpenChange])
  useRegisterAgentOrchestrateAddAction('cli', openCliToolDialogFromPrompt)
  const toolsTip = t('agentDetail.configure.tools.tip')
  const toolsListId = 'agent-configure-tools-list'

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
            onAddTools={addTools}
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
                onOpenChange={setToolOpen}
                onConfigureAction={setSettingTarget}
                onDeleteCliTool={deleteCliTool}
                onDeleteProviderTool={deleteProviderTool}
                onDeleteProviderToolAction={deleteProviderToolAction}
                onEditCliTool={editCliTool}
              />
            ))}
      </ConfigureSection>
      <ProviderToolSettingsDialog
        settingTarget={settingTarget}
        onClose={closeProviderSettingsDialog}
      />
      <CliToolDialog
        key={`${editingCliTool?.id ?? 'add'}:${isCliToolDialogOpen ? 'open' : 'closed'}`}
        mode={editingCliTool ? 'edit' : 'add'}
        tool={editingCliTool}
        onSaveCliTool={handleCliDialogSaveWithPromptInsert}
        open={isCliToolDialogOpen}
        onOpenChange={handleCliDialogOpenChangeWithPromptInsert}
      />
    </>
  )
}
