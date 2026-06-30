'use client'

import type { AgentOrchestrateAddActionOptions } from '../add-actions-context'
import type { AgentProviderToolDefaultValue, ToolSettingTarget } from './types'
import type { ToolDefaultValue, ToolValue } from '@/app/components/workflow/block-selector/types'
import type { ToolWithProvider } from '@/app/components/workflow/types'
import type { AgentCliTool, AgentProviderTool, AgentTool } from '@/features/agent-v2/agent-composer/form-state'
import { cn } from '@langgenius/dify-ui/cn'
import { Popover, PopoverContent, PopoverTrigger } from '@langgenius/dify-ui/popover'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ToolPickerContent } from '@/app/components/workflow/block-selector/tool-picker'
import { useGetLanguage } from '@/context/i18n'
import { useSetProviderToolCredential } from '@/features/agent-v2/agent-composer/store-modules/tools'
import {
  useAllBuiltInTools,
  useAllCustomTools,
  useAllMCPTools,
  useAllWorkflowTools,
} from '@/service/use-tools'
import { useRegisterAgentOrchestrateAddAction } from '../add-actions-context'
import { ConfigureSectionAddButton } from '../common/add-button'
import { ConfigureSectionEmpty } from '../common/empty'
import { ConfigureSection } from '../common/section'
import { useAgentOrchestrateReadOnly } from '../read-only-context'
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
  onCredentialChange,
}: {
  tool: AgentTool
  isExpanded: boolean
  onOpenChange: (tool: AgentTool, open: boolean) => void
  onConfigureAction: (target: ToolSettingTarget) => void
  onDeleteCliTool: (toolId: string) => void
  onDeleteProviderTool: (toolId: string) => void
  onDeleteProviderToolAction: (toolId: string, actionId: string) => void
  onEditCliTool: (tool: AgentCliTool) => void
  onCredentialChange: (toolId: string, credentialId?: string) => void
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

  const handleCredentialChange = useCallback((credentialId?: string) => {
    onCredentialChange(tool.id, credentialId)
  }, [onCredentialChange, tool.id])

  if (tool.kind === 'provider') {
    return (
      <AgentProviderToolItem
        tool={tool}
        isExpanded={isExpanded}
        onOpenChange={handleOpenChange}
        onConfigureAction={onConfigureAction}
        onRemoveAction={handleRemoveProviderAction}
        onRemoveProvider={handleRemoveProvider}
        onCredentialChange={handleCredentialChange}
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

function useAgentToolProviderMap() {
  const { data: buildInTools } = useAllBuiltInTools()
  const { data: customTools } = useAllCustomTools()
  const { data: workflowTools } = useAllWorkflowTools()
  const { data: mcpTools } = useAllMCPTools()

  return useMemo(() => {
    const providers = new Map<string, ToolWithProvider>()
    const buildInToolList = Array.isArray(buildInTools) ? buildInTools : []
    const customToolList = Array.isArray(customTools) ? customTools : []
    const workflowToolList = Array.isArray(workflowTools) ? workflowTools : []
    const mcpToolList = Array.isArray(mcpTools) ? mcpTools : []
    const allProviders = [
      ...buildInToolList,
      ...customToolList,
      ...workflowToolList,
      ...mcpToolList,
    ]

    allProviders.forEach((provider) => {
      providers.set(provider.id, provider)
      providers.set(provider.name, provider)
      if (provider.plugin_id) {
        providers.set(provider.plugin_id, provider)
        providers.set(`${provider.plugin_id}/${provider.name}`, provider)
      }
    })

    return providers
  }, [buildInTools, customTools, workflowTools, mcpTools])
}

function getLocalizedText(
  text: Record<string, string> | undefined,
  language: string,
) {
  return text?.[language] ?? text?.en_US ?? text?.zh_Hans
}

function getProviderCredentialRequired(provider?: ToolWithProvider) {
  return Object.keys(provider?.team_credentials ?? {}).length > 0
}

function useDisplayTools(
  tools: AgentTool[],
  providerById: Map<string, ToolWithProvider>,
) {
  const language = useGetLanguage()

  return useMemo(() => {
    return tools.map((tool) => {
      if (tool.kind !== 'provider')
        return tool

      const provider = providerById.get(tool.id)
        ?? providerById.get(tool.name)

      if (!provider)
        return tool

      const providerToolByName = new Map(provider.tools.map(providerTool => [providerTool.name, providerTool]))
      const credentialRequired = getProviderCredentialRequired(provider)

      return {
        ...tool,
        displayName: tool.displayName ?? getLocalizedText(provider.label, language) ?? tool.name,
        icon: tool.icon ?? provider.icon,
        iconDark: tool.iconDark ?? provider.icon_dark,
        providerType: tool.providerType ?? provider.type,
        allowDelete: tool.allowDelete ?? provider.allow_delete,
        credentialKey: credentialRequired ? tool.credentialKey : undefined,
        credentialType: credentialRequired ? tool.credentialType : undefined,
        credentialVariant: credentialRequired ? tool.credentialVariant : 'none',
        actions: tool.actions.map((action) => {
          const providerTool = providerToolByName.get(action.toolName)

          if (!providerTool)
            return action

          return {
            ...action,
            name: action.name === action.toolName
              ? getLocalizedText(providerTool.label, language) ?? action.name
              : action.name,
            description: action.description || getLocalizedText(providerTool.description, language) || '',
          }
        }),
      } satisfies AgentProviderTool
    })
  }, [language, providerById, tools])
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
  onAddTools: (tools: AgentProviderToolDefaultValue[]) => void
  selectedTools: ToolValue[]
}) {
  const { t } = useTranslation('agentV2')
  const [open, setOpen] = useState(false)
  const [view, setView] = useState<'menu' | 'tool-picker'>('menu')
  const providerById = useAgentToolProviderMap()

  const openToolPicker = useCallback(() => {
    setView('tool-picker')
  }, [])

  const openCliToolDialog = useCallback(() => {
    setOpen(false)
    onAddCliTool()
  }, [onAddCliTool])

  const handleOpenChange = useCallback((nextOpen: boolean) => {
    setOpen(nextOpen)

    if (nextOpen)
      setView('menu')
  }, [])

  const toAgentToolDefaultValue = useCallback((tool: ToolDefaultValue): AgentProviderToolDefaultValue => ({
    ...tool,
    allowDelete: (providerById.get(tool.provider_id)
      ?? providerById.get(tool.provider_name)
      ?? (tool.plugin_id ? providerById.get(tool.plugin_id) : undefined))?.allow_delete,
    credentialRequired: getProviderCredentialRequired(providerById.get(tool.provider_id)
      ?? providerById.get(tool.provider_name)
      ?? (tool.plugin_id ? providerById.get(tool.plugin_id) : undefined)),
  }), [providerById])

  const handleSelectTool = useCallback((tool: ToolDefaultValue) => {
    onAddTools([toAgentToolDefaultValue(tool)])
  }, [onAddTools, toAgentToolDefaultValue])

  const handleSelectMultipleTools = useCallback((tools: ToolDefaultValue[]) => {
    onAddTools(tools.map(toAgentToolDefaultValue))
  }, [onAddTools, toAgentToolDefaultValue])

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger
        render={(
          <ConfigureSectionAddButton ariaLabel={t('agentDetail.configure.tools.add')} />
        )}
      />
      <PopoverContent
        placement="bottom-end"
        sideOffset={4}
        popupClassName={view === 'menu'
          ? 'w-[280px] bg-components-panel-bg-blur p-1 shadow-lg backdrop-blur-[5px]'
          : 'w-[400px] overflow-hidden border-none bg-transparent p-0 shadow-none'}
      >
        {view === 'menu'
          ? (
              <>
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
              </>
            )
          : (
              <ToolPickerContent
                focusSearchOnMount
                panelClassName="w-full"
                supportAddCustomTool
                selectedTools={selectedTools}
                onSelect={handleSelectTool}
                onSelectMultiple={handleSelectMultipleTools}
              />
            )}
      </PopoverContent>
    </Popover>
  )
}

export function AgentTools() {
  const { t } = useTranslation('agentV2')
  const readOnly = useAgentOrchestrateReadOnly()
  const setProviderToolCredential = useSetProviderToolCredential()
  const providerById = useAgentToolProviderMap()
  const {
    tools,
    selectedTools,
    expandedToolIds,
    settingTarget,
    isCliToolDialogOpen,
    editingCliTool,
    setTools,
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
  const displayTools = useDisplayTools(tools, providerById)
  useEffect(() => {
    if (readOnly)
      return

    let shouldSyncCredentials = false
    const nextTools = tools.map((tool, index) => {
      const displayTool = displayTools[index]

      if (tool.kind !== 'provider' || displayTool?.kind !== 'provider')
        return tool

      if (
        tool.allowDelete === displayTool.allowDelete
        && tool.credentialKey === displayTool.credentialKey
        && tool.credentialType === displayTool.credentialType
        && tool.credentialVariant === displayTool.credentialVariant
      ) {
        return tool
      }

      shouldSyncCredentials = true
      return {
        ...tool,
        allowDelete: displayTool.allowDelete,
        credentialKey: displayTool.credentialKey,
        credentialType: displayTool.credentialType,
        credentialVariant: displayTool.credentialVariant,
      }
    })

    if (shouldSyncCredentials)
      setTools(nextTools)
  }, [displayTools, readOnly, setTools, tools])
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
  const settingTargetCollection = settingTarget
    ? providerById.get(settingTarget.tool.id)
    ?? providerById.get(settingTarget.tool.name)
    : undefined

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
        actions={!readOnly
          ? (
              <AddToolMenu
                onAddCliTool={openCliToolDialog}
                onAddTools={addTools}
                selectedTools={selectedTools}
              />
            )
          : undefined}
      >
        {displayTools.length === 0
          ? (
              <ConfigureSectionEmpty
                title={t('agentDetail.configure.tools.empty.title')}
                description={t('agentDetail.configure.tools.empty.description')}
              />
            )
          : displayTools.map(tool => (
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
                onCredentialChange={setProviderToolCredential}
              />
            ))}
      </ConfigureSection>
      <ProviderToolSettingsDialog
        settingTarget={settingTarget}
        collection={settingTargetCollection}
        onClose={closeProviderSettingsDialog}
      />
      <CliToolDialog
        key={`${editingCliTool?.id ?? 'add'}:${isCliToolDialogOpen ? 'open' : 'closed'}`}
        mode={editingCliTool ? 'edit' : 'add'}
        tool={editingCliTool}
        onDeleteCliTool={deleteCliTool}
        onSaveCliTool={handleCliDialogSaveWithPromptInsert}
        open={isCliToolDialogOpen}
        onOpenChange={handleCliDialogOpenChangeWithPromptInsert}
      />
    </>
  )
}
