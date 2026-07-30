'use client'

import type { MarketplacePlugin } from '@dify/contracts/marketplace'
import type { AgentOrchestrateAddActionOptions } from '../add-actions-context'
import type { ToolSettingTarget } from './types'
import type { ToolDefaultValue, ToolValue } from '@/app/components/workflow/block-selector/types'
import type { ToolWithProvider } from '@/app/components/workflow/types'
import type {
  AgentCliTool,
  AgentProviderTool,
  AgentTool,
} from '@/features/agent-v2/agent-composer/form-state'
import type { AgentProviderToolDefaultValue } from '@/features/agent-v2/agent-composer/store-modules/tools'
import { cn } from '@langgenius/dify-ui/cn'
import { Popover, PopoverContent, PopoverTrigger } from '@langgenius/dify-ui/popover'
import { useAtomValue, useSetAtom } from 'jotai'
import { memo, useCallback, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { parseToolProviderType } from '@/app/components/tools/provider-type'
import { CollectionType } from '@/app/components/tools/types'
import { ToolPickerContent } from '@/app/components/workflow/block-selector/tool-picker'
import { useGetLanguage } from '@/context/i18n'
import {
  addProviderToolsAtom,
  agentComposerToolsAtom,
  setProviderToolCredentialAtom,
} from '@/features/agent-v2/agent-composer/store-modules/tools'
import { ENABLE_AGENT_CLI_TOOLS } from '@/features/agent-v2/agent-detail/configure/feature-flags'
import {
  useFetchPluginsInMarketPlaceByInfo,
  useInvalidateInstalledPluginList,
} from '@/service/use-plugins'
import {
  useAllBuiltInTools,
  useAllCustomTools,
  useAllMCPTools,
  useAllWorkflowTools,
  useInvalidateAllBuiltInTools,
} from '@/service/use-tools'
import { getIconFromMarketPlace } from '@/utils/get-icon'
import { useRegisterAgentOrchestrateAddAction } from '../add-actions-context'
import { ConfigureSectionAddButton } from '../common/add-button'
import { ConfigureSectionEmpty } from '../common/empty'
import { ConfigureSection } from '../common/section'
import { AgentConfigureTipContent } from '../common/tip-content'
import { useAgentOrchestrateReadOnly } from '../read-only-context'
import { CliToolDialog } from './cli-tool/dialog'
import { AgentCliToolItem } from './cli-tool/item'
import {
  useCliToolDialogSurface,
  useProviderToolSettingsSurface,
  useSelectedProviderTools,
} from './hooks'
import { ProviderToolSettingsDialog } from './provider-tool/dialog'
import { AgentProviderToolItem } from './provider-tool/item'

type DisplayAgentProviderTool = AgentProviderTool & {
  isInstalled?: boolean
}

type DisplayAgentTool = AgentCliTool | DisplayAgentProviderTool

const AgentToolItem = memo(
  ({
    tool,
    onConfigureAction,
    onDeleteCliTool,
    onDeleteProviderTool,
    onDeleteProviderToolAction,
    onEditCliTool,
    onCredentialChange,
    onPluginInstalled,
  }: {
    tool: DisplayAgentTool
    onConfigureAction: (target: ToolSettingTarget) => void
    onDeleteCliTool: (toolId: string) => void
    onDeleteProviderTool: (toolId: string) => void
    onDeleteProviderToolAction: (toolId: string, actionId: string) => void
    onEditCliTool: (tool: AgentCliTool) => void
    onCredentialChange: (
      toolId: string,
      credentialId?: string,
      credentialType?: AgentProviderTool['credentialType'],
    ) => void
    onPluginInstalled: () => void
  }) => {
    const [isExpanded, setIsExpanded] = useState(false)

    const handleRemoveProvider = useCallback(() => {
      onDeleteProviderTool(tool.id)
    }, [onDeleteProviderTool, tool.id])

    const handleRemoveProviderAction = useCallback(
      (actionId: string) => {
        onDeleteProviderToolAction(tool.id, actionId)
      },
      [onDeleteProviderToolAction, tool.id],
    )

    const handleDeleteCliTool = useCallback(() => {
      onDeleteCliTool(tool.id)
    }, [onDeleteCliTool, tool.id])

    const handleEditCliTool = useCallback(() => {
      if (tool.kind === 'cli') onEditCliTool(tool)
    }, [onEditCliTool, tool])

    const handleCredentialChange = useCallback(
      (credentialId?: string, credentialType?: AgentProviderTool['credentialType']) => {
        onCredentialChange(tool.id, credentialId, credentialType)
      },
      [onCredentialChange, tool.id],
    )

    if (tool.kind === 'provider') {
      return (
        <AgentProviderToolItem
          tool={tool}
          isInstalled={tool.isInstalled}
          isExpanded={isExpanded}
          onOpenChange={setIsExpanded}
          onConfigureAction={onConfigureAction}
          onRemoveAction={handleRemoveProviderAction}
          onRemoveProvider={handleRemoveProvider}
          onCredentialChange={handleCredentialChange}
          onInstall={onPluginInstalled}
        />
      )
    }

    return (
      <AgentCliToolItem tool={tool} onDelete={handleDeleteCliTool} onEdit={handleEditCliTool} />
    )
  },
)

function useAgentToolProviderMap() {
  const { data: buildInTools } = useAllBuiltInTools()
  const { data: customTools } = useAllCustomTools()
  const { data: workflowTools } = useAllWorkflowTools()
  const { data: mcpTools } = useAllMCPTools()

  return useMemo(() => {
    const providers = new Map<string, ToolWithProvider>()
    const resolvedProviderTypes = new Set<AgentProviderTool['providerType']>()
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

    if (Array.isArray(buildInTools)) {
      resolvedProviderTypes.add(CollectionType.builtIn)
      resolvedProviderTypes.add('plugin')
    }
    if (Array.isArray(customTools)) resolvedProviderTypes.add(CollectionType.custom)
    if (Array.isArray(workflowTools)) resolvedProviderTypes.add(CollectionType.workflow)
    if (Array.isArray(mcpTools)) resolvedProviderTypes.add(CollectionType.mcp)

    allProviders.forEach((provider) => {
      providers.set(provider.id, provider)
      providers.set(provider.name, provider)
      if (provider.plugin_id) {
        providers.set(provider.plugin_id, provider)
        providers.set(`${provider.plugin_id}/${provider.name}`, provider)
      }
    })

    return {
      providerById: providers,
      resolvedProviderTypes,
    }
  }, [buildInTools, customTools, workflowTools, mcpTools])
}

function getLocalizedText(text: Partial<Record<string, string>> | undefined, language: string) {
  return text?.[language] ?? text?.en_US ?? text?.zh_Hans
}

function getProviderPluginId(tool: AgentProviderTool) {
  if (tool.pluginId) return tool.pluginId

  if (tool.providerType !== 'plugin' && tool.providerType !== CollectionType.builtIn) return ''

  const providerIdSegments = tool.id.split('/')
  if (providerIdSegments.length !== 3) return ''

  return providerIdSegments.slice(0, 2).join('/')
}

function getProviderDisplayName(tool: AgentProviderTool) {
  const providerIdSegments = tool.name.split('/').filter(Boolean)
  return providerIdSegments.at(-1) ?? tool.name
}

function getMarketplacePluginInfo(pluginId: string) {
  const [organization, plugin, ...remainingSegments] = pluginId.split('/')
  if (!organization || !plugin || remainingSegments.length > 0) return undefined

  return {
    organization,
    plugin,
  }
}

function getProviderCredentialType(
  provider?: ToolWithProvider,
): AgentProviderTool['credentialType'] {
  if (!provider) return undefined

  if (Object.keys(provider.team_credentials ?? {}).length > 0) return 'api-key'

  if (provider.type === CollectionType.builtIn && provider.allow_delete) return 'oauth2'

  return undefined
}

function getDisplayCredentialType(
  tool: AgentProviderTool,
  providerCredentialType: AgentProviderTool['credentialType'],
) {
  if (!providerCredentialType) return undefined

  if (providerCredentialType === 'oauth2' && tool.credentialType === 'unauthorized')
    return 'oauth2' as const

  return tool.credentialType ?? providerCredentialType
}

function getProviderCredentialVariant(
  tool: AgentProviderTool,
  provider: ToolWithProvider,
  providerCredentialType: AgentProviderTool['credentialType'],
) {
  if (!providerCredentialType) return 'none' as const

  if (tool.credentialVariant !== 'none') return tool.credentialVariant

  return tool.credentialId || provider.is_team_authorization
    ? ('authorized' as const)
    : ('unauthorized' as const)
}

function useDisplayTools(
  tools: AgentTool[],
  providerById: Map<string, ToolWithProvider>,
  resolvedProviderTypes: Set<AgentProviderTool['providerType']>,
  marketplacePluginById: Map<string, MarketplacePlugin>,
) {
  const language = useGetLanguage()

  return useMemo(() => {
    return tools.map((tool): DisplayAgentTool => {
      if (tool.kind !== 'provider') return tool

      const provider = providerById.get(tool.id) ?? providerById.get(tool.name)

      if (!provider) {
        const providerPluginId = getProviderPluginId(tool)
        const marketplacePlugin = marketplacePluginById.get(providerPluginId)

        return {
          ...tool,
          isInstalled: resolvedProviderTypes.has(tool.providerType) ? false : undefined,
          pluginId: tool.pluginId ?? providerPluginId,
          pluginUniqueIdentifier:
            tool.pluginUniqueIdentifier ?? marketplacePlugin?.latest_package_identifier,
          displayName:
            tool.displayName ??
            getLocalizedText(marketplacePlugin?.label ?? marketplacePlugin?.labels, language) ??
            marketplacePlugin?.name ??
            getProviderDisplayName(tool),
          icon:
            tool.icon ??
            (marketplacePlugin && providerPluginId
              ? getIconFromMarketPlace(providerPluginId)
              : undefined),
        }
      }

      const providerToolByName = new Map(
        provider.tools.map((providerTool) => [providerTool.name, providerTool]),
      )
      const providerCredentialType = getProviderCredentialType(provider)

      return {
        ...tool,
        isInstalled: true,
        displayName: tool.displayName ?? getLocalizedText(provider.label, language) ?? tool.name,
        icon: tool.icon ?? provider.icon,
        iconDark: tool.iconDark ?? provider.icon_dark,
        providerType: tool.providerType,
        allowDelete: tool.allowDelete ?? provider.allow_delete,
        credentialKey: providerCredentialType
          ? (tool.credentialKey ?? 'agentDetail.configure.tools.credential.authOne')
          : undefined,
        credentialType: getDisplayCredentialType(tool, providerCredentialType),
        credentialVariant: getProviderCredentialVariant(tool, provider, providerCredentialType),
        actions: tool.actions.map((action) => {
          const providerTool = providerToolByName.get(action.toolName)

          if (!providerTool) return action

          return {
            ...action,
            name:
              action.name === action.toolName
                ? (getLocalizedText(providerTool.label, language) ?? action.name)
                : action.name,
            description:
              action.description || getLocalizedText(providerTool.description, language) || '',
          }
        }),
      } satisfies DisplayAgentProviderTool
    })
  }, [language, marketplacePluginById, providerById, resolvedProviderTypes, tools])
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
      <span
        aria-hidden
        className={cn('mt-0.5 size-4 shrink-0 text-text-secondary', iconClassName)}
      />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex min-w-0 items-center gap-1">
          <span className="truncate system-sm-semibold text-text-secondary">{label}</span>
          {badge && (
            <span className="shrink-0 rounded-[5px] border border-divider-deep bg-components-badge-bg-dimm px-1 py-0.5 system-2xs-medium-uppercase text-text-tertiary">
              {badge}
            </span>
          )}
        </span>
        <span className="system-xs-regular text-text-tertiary">{description}</span>
      </span>
    </button>
  )
}

type AddToolMenuView = 'menu' | 'tool-picker'

// CLI tools are not available yet, so open the tool picker directly for now.
// Switch this back to 'menu' when the CLI tool entry returns.
const addToolDefaultView = 'tool-picker' satisfies AddToolMenuView

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
  const [view, setView] = useState<AddToolMenuView>(addToolDefaultView)
  const { providerById } = useAgentToolProviderMap()

  const openToolPicker = useCallback(() => {
    setView('tool-picker')
  }, [])

  const openCliToolDialog = useCallback(() => {
    setOpen(false)
    onAddCliTool()
  }, [onAddCliTool])

  const handleOpenChange = useCallback((nextOpen: boolean) => {
    setOpen(nextOpen)

    if (nextOpen) setView(addToolDefaultView)
  }, [])

  const toAgentToolDefaultValue = useCallback(
    (tool: ToolDefaultValue): AgentProviderToolDefaultValue => ({
      ...tool,
      provider_type: parseToolProviderType(tool.provider_type),
      allowDelete: (
        providerById.get(tool.provider_id) ??
        providerById.get(tool.provider_name) ??
        (tool.plugin_id ? providerById.get(tool.plugin_id) : undefined)
      )?.allow_delete,
      credentialType: getProviderCredentialType(
        providerById.get(tool.provider_id) ??
          providerById.get(tool.provider_name) ??
          (tool.plugin_id ? providerById.get(tool.plugin_id) : undefined),
      ),
      credentialRequired: !!getProviderCredentialType(
        providerById.get(tool.provider_id) ??
          providerById.get(tool.provider_name) ??
          (tool.plugin_id ? providerById.get(tool.plugin_id) : undefined),
      ),
    }),
    [providerById],
  )

  const handleSelectTool = useCallback(
    (tool: ToolDefaultValue) => {
      onAddTools([toAgentToolDefaultValue(tool)])
    },
    [onAddTools, toAgentToolDefaultValue],
  )

  const handleSelectMultipleTools = useCallback(
    (tools: ToolDefaultValue[]) => {
      onAddTools(tools.map(toAgentToolDefaultValue))
    },
    [onAddTools, toAgentToolDefaultValue],
  )

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger
        render={
          <ConfigureSectionAddButton ariaLabel={t(($) => $['agentDetail.configure.tools.add'])} />
        }
      />
      <PopoverContent
        placement="bottom-end"
        sideOffset={4}
        popupClassName={
          view === 'menu'
            ? 'w-[280px] bg-components-panel-bg-blur p-1 shadow-lg backdrop-blur-[5px]'
            : 'w-[400px] overflow-hidden border-none bg-transparent p-0 shadow-none'
        }
      >
        {view === 'menu' ? (
          <>
            <AddToolMenuItem
              iconClassName="i-ri-box-3-line"
              label={t(($) => $['agentDetail.configure.tools.addMenu.tool.label'])}
              description={t(($) => $['agentDetail.configure.tools.addMenu.tool.description'])}
              onClick={openToolPicker}
            />
            {ENABLE_AGENT_CLI_TOOLS && (
              <AddToolMenuItem
                iconClassName="i-ri-terminal-box-line"
                label={t(($) => $['agentDetail.configure.tools.addMenu.cliTool.label'])}
                badge={t(($) => $['agentDetail.configure.tools.addMenu.cliTool.badge'])}
                description={t(($) => $['agentDetail.configure.tools.addMenu.cliTool.description'])}
                onClick={openCliToolDialog}
              />
            )}
          </>
        ) : (
          <ToolPickerContent
            focusSearchOnMount
            panelClassName="w-full overflow-hidden"
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
  const setProviderToolCredential = useSetAtom(setProviderToolCredentialAtom)
  const invalidateAllBuiltInTools = useInvalidateAllBuiltInTools()
  const invalidateInstalledPluginList = useInvalidateInstalledPluginList()
  const { providerById, resolvedProviderTypes } = useAgentToolProviderMap()
  const tools = useAtomValue(agentComposerToolsAtom)
  const selectedTools = useSelectedProviderTools()
  const addTools = useSetAtom(addProviderToolsAtom)
  const {
    settingTarget,
    setSettingTarget,
    deleteProviderTool,
    deleteProviderToolAction,
    closeProviderSettingsDialog,
  } = useProviderToolSettingsSurface()
  const {
    isCliToolDialogOpen,
    editingCliTool,
    deleteCliTool,
    openCliToolDialog,
    editCliTool,
    handleCliDialogSave,
    handleCliDialogOpenChange,
  } = useCliToolDialogSurface()
  const handleProviderCredentialChange = useCallback(
    (
      toolId: string,
      credentialId?: string,
      credentialType?: AgentProviderTool['credentialType'],
    ) => {
      setProviderToolCredential({ toolId, credentialId, credentialType })
    },
    [setProviderToolCredential],
  )
  const handlePluginInstalled = useCallback(() => {
    void Promise.allSettled([invalidateAllBuiltInTools(), invalidateInstalledPluginList()])
  }, [invalidateAllBuiltInTools, invalidateInstalledPluginList])
  const visibleTools = useMemo(
    () => (ENABLE_AGENT_CLI_TOOLS ? tools : tools.filter((tool) => tool.kind !== 'cli')),
    [tools],
  )
  const missingMarketplacePluginInfos = useMemo(() => {
    const pluginIds = new Set<string>()

    visibleTools.forEach((tool) => {
      if (
        tool.kind !== 'provider' ||
        !resolvedProviderTypes.has(tool.providerType) ||
        providerById.has(tool.id) ||
        providerById.has(tool.name)
      )
        return

      const pluginId = getProviderPluginId(tool)
      if (pluginId) pluginIds.add(pluginId)
    })

    return Array.from(pluginIds).flatMap((pluginId) => {
      const info = getMarketplacePluginInfo(pluginId)
      return info ? [info] : []
    })
  }, [providerById, resolvedProviderTypes, visibleTools])
  const { data: missingMarketplacePluginsData } = useFetchPluginsInMarketPlaceByInfo(
    missingMarketplacePluginInfos,
  )
  const marketplacePluginById = useMemo(
    () =>
      new Map(
        (missingMarketplacePluginsData?.data.list ?? []).map(({ plugin }) => [
          plugin.plugin_id,
          plugin,
        ]),
      ),
    [missingMarketplacePluginsData],
  )
  const displayTools = useDisplayTools(
    visibleTools,
    providerById,
    resolvedProviderTypes,
    marketplacePluginById,
  )
  /*
   * knip-ignore-start
   * Keep this disabled sync logic while backend credential snapshots are being investigated.
   * Re-enabling it writes catalog-derived credential metadata into the composer draft on page entry.
   * That can mark a published agent as locally dirty before the user changes anything.
   *
   * const displayToolById = useMemo(
   *   () => new Map(displayTools.map(tool => [tool.id, tool])),
   *   [displayTools],
   * )
   *
   * useEffect(() => {
   *   if (readOnly)
   *     return
   *
   *   let shouldSyncCredentials = false
   *   const nextTools = tools.map((tool) => {
   *     const displayTool = displayToolById.get(tool.id)
   *
   *     if (tool.kind !== 'provider' || displayTool?.kind !== 'provider')
   *       return tool
   *
   *     if (
   *       tool.allowDelete === displayTool.allowDelete
   *       && tool.credentialKey === displayTool.credentialKey
   *       && tool.credentialType === displayTool.credentialType
   *       && tool.credentialVariant === displayTool.credentialVariant
   *     ) {
   *       return tool
   *     }
   *
   *     shouldSyncCredentials = true
   *     return {
   *       ...tool,
   *       allowDelete: displayTool.allowDelete,
   *       credentialKey: displayTool.credentialKey,
   *       credentialType: displayTool.credentialType,
   *       credentialVariant: displayTool.credentialVariant,
   *     }
   *   })
   *
   *   if (shouldSyncCredentials)
   *     setTools(nextTools)
   * }, [displayToolById, readOnly, setTools, tools])
   * knip-ignore-end
   */
  const promptAddCallbackRef = useRef<AgentOrchestrateAddActionOptions['onAdded']>(undefined)
  const openCliToolDialogFromPrompt = useCallback(
    (options?: AgentOrchestrateAddActionOptions) => {
      promptAddCallbackRef.current = options?.onAdded
      openCliToolDialog()
    },
    [openCliToolDialog],
  )
  const handleCliDialogSaveWithPromptInsert = useCallback(
    (tool: AgentCliTool) => {
      handleCliDialogSave(tool)
      if (!editingCliTool) {
        promptAddCallbackRef.current?.(tool)
        promptAddCallbackRef.current = undefined
      }
    },
    [editingCliTool, handleCliDialogSave],
  )
  const handleCliDialogOpenChangeWithPromptInsert = useCallback(
    (open: boolean) => {
      if (!open) promptAddCallbackRef.current = undefined
      handleCliDialogOpenChange(open)
    },
    [handleCliDialogOpenChange],
  )
  useRegisterAgentOrchestrateAddAction(
    'cli',
    ENABLE_AGENT_CLI_TOOLS ? openCliToolDialogFromPrompt : () => {},
  )
  const toolsTip = t(($) => $['agentDetail.configure.tools.tip'])
  const toolsListId = 'agent-configure-tools-list'
  const settingTargetTool = settingTarget
    ? tools.find((tool) => tool.kind === 'provider' && tool.id === settingTarget.toolId)
    : undefined
  const settingTargetCollection = settingTarget
    ? (providerById.get(settingTarget.toolId) ??
      providerById.get(settingTargetTool?.name ?? settingTarget.toolId))
    : undefined

  return (
    <>
      <ConfigureSection
        label={t(($) => $['agentDetail.configure.tools.label'])}
        labelId="agent-configure-tools-label"
        panelId={toolsListId}
        tip={<AgentConfigureTipContent type="tools" />}
        tipAriaLabel={toolsTip}
        rootClassName="border-b border-divider-subtle pt-4"
        panelContentClassName="flex flex-col gap-1 pb-4"
        actions={
          !readOnly ? (
            <AddToolMenu
              onAddCliTool={openCliToolDialog}
              onAddTools={addTools}
              selectedTools={selectedTools}
            />
          ) : undefined
        }
      >
        {displayTools.length === 0 ? (
          <ConfigureSectionEmpty
            title={t(($) => $['agentDetail.configure.tools.empty.title'])}
            description={t(($) => $['agentDetail.configure.tools.empty.description'])}
          />
        ) : (
          displayTools.map((tool) => (
            <AgentToolItem
              key={tool.id}
              tool={tool}
              onConfigureAction={setSettingTarget}
              onDeleteCliTool={deleteCliTool}
              onDeleteProviderTool={deleteProviderTool}
              onDeleteProviderToolAction={deleteProviderToolAction}
              onEditCliTool={editCliTool}
              onCredentialChange={handleProviderCredentialChange}
              onPluginInstalled={handlePluginInstalled}
            />
          ))
        )}
      </ConfigureSection>
      <ProviderToolSettingsDialog
        settingTarget={settingTarget}
        collection={settingTargetCollection}
        onClose={closeProviderSettingsDialog}
      />
      {ENABLE_AGENT_CLI_TOOLS && (
        <CliToolDialog
          key={`${editingCliTool?.id ?? 'add'}:${isCliToolDialogOpen ? 'open' : 'closed'}`}
          mode={editingCliTool ? 'edit' : 'add'}
          tool={editingCliTool}
          onDeleteCliTool={deleteCliTool}
          onSaveCliTool={handleCliDialogSaveWithPromptInsert}
          open={isCliToolDialogOpen}
          onOpenChange={handleCliDialogOpenChangeWithPromptInsert}
        />
      )}
    </>
  )
}
