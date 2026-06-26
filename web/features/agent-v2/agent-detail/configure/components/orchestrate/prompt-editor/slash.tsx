'use client'

import type { ReactNode } from 'react'
import type { AgentOrchestrateAddAction, AgentOrchestrateAddedItem } from '../add-actions-context'
import type { AgentProviderToolDefaultValue } from '../tools/types'
import type { Tool } from '@/app/components/tools/types'
import type { ToolTypeEnum, ToolValue } from '@/app/components/workflow/block-selector/types'
import type { ToolWithProvider } from '@/app/components/workflow/types'
import type { AgentFileNode, AgentKnowledgeRetrievalItem, AgentSkill, AgentTool } from '@/features/agent-v2/agent-composer/form-state'
import { cn } from '@langgenius/dify-ui/cn'
import { FileTreeIcon } from '@langgenius/dify-ui/file-tree'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { getMarketplaceCategoryUrl } from '@/app/components/plugins/marketplace/utils'
import { PluginCategoryEnum } from '@/app/components/plugins/types'
import { CollectionType } from '@/app/components/tools/types'
import BlockIcon from '@/app/components/workflow/block-icon'
import { ToolTypeEnum as ToolTabEnum } from '@/app/components/workflow/block-selector/types'
import { BlockEnum } from '@/app/components/workflow/types'
import { useGetLanguage } from '@/context/i18n'
import { ENABLE_AGENT_CLI_TOOLS } from '@/features/agent-v2/agent-detail/configure/feature-flags'
import {
  useAllBuiltInTools,
  useAllCustomTools,
  useAllMCPTools,
  useAllWorkflowTools,
} from '@/service/use-tools'
import { addProviderTools } from '../tools/hooks'
import { useAgentPromptToolIconResolver } from './hooks'

export type SlashMenuView = 'main' | 'skills' | 'files' | 'tools' | 'knowledge'

export type SlashMenuCategory = {
  key: Exclude<SlashMenuView, 'main'>
  label: string
  icon: string
}

type AgentPromptSlashMenuProps = {
  view: SlashMenuView
  categories: SlashMenuCategory[]
  skills: AgentSkill[]
  files: AgentFileNode[]
  tools: AgentTool[]
  onToolsChange: (tools: AgentTool[]) => void
  onAddCliTool?: AgentOrchestrateAddAction
  onAddFile?: AgentOrchestrateAddAction
  onAddKnowledge?: AgentOrchestrateAddAction
  onAddSkill?: AgentOrchestrateAddAction
  retrievals: AgentKnowledgeRetrievalItem[]
  onBack: () => void
  onOpenCategory: (view: Exclude<SlashMenuView, 'main'>) => void
  onSelect: (token: string) => void
}

const createReferenceToken = (kind: string, id: string, label?: string) => (
  `[§${kind}:${id}${label ? `:${label}` : ''}§]`
)

const createDriveReferenceToken = (kind: 'skill' | 'file', driveKey: string, label: string) => (
  createReferenceToken(kind, encodeURIComponent(driveKey), label)
)

const isPromptReferenceItem = (item: AgentOrchestrateAddedItem): item is AgentFileNode | AgentSkill => (
  'id' in item && 'name' in item
)

const isCliToolItem = (item: AgentOrchestrateAddedItem): item is Extract<AgentTool, { kind: 'cli' }> => (
  'kind' in item && item.kind === 'cli'
)

const isKnowledgeRetrievalItem = (item: AgentOrchestrateAddedItem): item is AgentKnowledgeRetrievalItem => (
  'queryMode' in item || 'customQuery' in item || 'selectedDatasets' in item || 'nameKey' in item
)

export function AgentPromptSlashMenu({
  view,
  categories,
  skills,
  files,
  tools,
  onToolsChange,
  onAddCliTool,
  onAddFile,
  onAddKnowledge,
  onAddSkill,
  retrievals,
  onBack,
  onOpenCategory,
  onSelect,
}: AgentPromptSlashMenuProps) {
  const { t } = useTranslation('agentV2')
  const title = categories.find(category => category.key === view)?.label
  const handleAddFromFooter = () => {
    if (view === 'skills') {
      onAddSkill?.({
        onAdded: (item) => {
          if (isPromptReferenceItem(item) && 'skillMdKey' in item && typeof item.skillMdKey === 'string')
            onSelect(createDriveReferenceToken('skill', item.skillMdKey, item.name))
        },
      })
      return
    }

    if (view === 'files') {
      onAddFile?.({
        onAdded: (item) => {
          if (isPromptReferenceItem(item) && 'driveKey' in item && typeof item.driveKey === 'string')
            onSelect(createDriveReferenceToken('file', item.driveKey, item.name))
        },
      })
      return
    }

    if (view === 'knowledge') {
      onAddKnowledge?.({
        onAdded: (item) => {
          if (isKnowledgeRetrievalItem(item))
            onSelect(createReferenceToken('knowledge', item.id, getKnowledgeRetrievalName(item, t)))
        },
      })
    }
  }

  if (view === 'main') {
    return (
      <AgentPromptSlashPanel className="w-[200px]">
        <div className="flex flex-col gap-px p-1">
          {categories.map(category => (
            <button
              key={category.key}
              type="button"
              className="flex h-6 w-full items-center gap-1 rounded-md pr-2 pl-3 text-left hover:bg-state-base-hover focus-visible:bg-state-base-hover focus-visible:outline-hidden"
              onClick={() => onOpenCategory(category.key)}
            >
              <span aria-hidden className={`${category.icon} size-4 shrink-0 text-text-secondary`} />
              <span className="min-w-0 flex-1 truncate system-sm-regular text-text-secondary">{category.label}</span>
              <span aria-hidden className="i-ri-arrow-right-s-line size-3.5 shrink-0 text-text-tertiary" />
            </button>
          ))}
        </div>
      </AgentPromptSlashPanel>
    )
  }

  return (
    <AgentPromptSlashPanel className="w-[360px]">
      <div className="flex flex-col p-1">
        <button
          type="button"
          className="flex h-6 w-full items-center gap-1 rounded-md pr-2 pl-3 text-left text-text-tertiary hover:bg-state-base-hover focus-visible:bg-state-base-hover focus-visible:outline-hidden"
          onClick={onBack}
        >
          <span aria-hidden className="i-ri-arrow-left-line size-4 shrink-0" />
          <span className="min-w-0 flex-1 truncate system-xs-medium-uppercase">{title}</span>
        </button>
        {view === 'skills' && (
          <AgentPromptSkillRows skills={skills} onSelect={onSelect} />
        )}
        {view === 'files' && (
          <AgentPromptFileRows files={files} onSelect={onSelect} />
        )}
        {view === 'tools' && (
          <AgentPromptToolRows
            configuredTools={tools}
            onConfiguredToolsChange={onToolsChange}
            onSelect={onSelect}
          />
        )}
        {view === 'knowledge' && (
          <AgentPromptKnowledgeRows retrievals={retrievals} onSelect={onSelect} />
        )}
      </div>
      {view === 'tools'
        ? (
            <AgentPromptToolFooter
              onAddCliTool={ENABLE_AGENT_CLI_TOOLS
                ? () => {
                    onAddCliTool?.({
                      onAdded: (item) => {
                        if (isCliToolItem(item))
                          onSelect(createReferenceToken('cli_tool', item.id, item.name))
                      },
                    })
                  }
                : undefined}
            />
          )
        : (
            <div className="border-t border-divider-subtle p-1">
              <button
                type="button"
                className="flex h-6 w-full items-center gap-1 rounded-md pr-2 pl-3 text-left hover:bg-state-base-hover focus-visible:bg-state-base-hover focus-visible:outline-hidden"
                onClick={handleAddFromFooter}
              >
                <span aria-hidden className="i-ri-add-line size-4 shrink-0 text-text-secondary" />
                <span className="system-sm-regular text-text-secondary">
                  {view === 'skills' && t('agentDetail.configure.skills.add')}
                  {view === 'files' && t('agentDetail.configure.files.add')}
                  {view === 'knowledge' && t('agentDetail.configure.knowledgeRetrieval.add')}
                </span>
              </button>
            </div>
          )}
    </AgentPromptSlashPanel>
  )
}

function AgentPromptSlashPanel({
  className,
  children,
}: {
  className: string
  children: ReactNode
}) {
  return (
    <div className={`${className} isolate overflow-hidden rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-bg-blur shadow-lg backdrop-blur-[5px]`}>
      {children}
    </div>
  )
}

function AgentPromptSkillRows({
  skills,
  onSelect,
}: {
  skills: AgentSkill[]
  onSelect: (token: string) => void
}) {
  return (
    <>
      {skills.map(skill => (
        <AgentPromptSubmenuRow
          key={skill.id}
          icon="i-ri-box-3-line"
          label={skill.name}
          onClick={() => skill.skillMdKey && onSelect(createDriveReferenceToken('skill', skill.skillMdKey, skill.name))}
        />
      ))}
    </>
  )
}

function AgentPromptFileRows({
  files,
  depth = 0,
  onSelect,
}: {
  files: AgentFileNode[]
  depth?: number
  onSelect: (token: string) => void
}) {
  return (
    <>
      {files.map(file => (
        <div key={file.id}>
          <AgentPromptSubmenuRow
            icon={<FileTreeIcon type={file.children?.length ? 'folder' : file.icon} />}
            label={file.name}
            depth={depth}
            hasChildren={!!file.children?.length}
            onClick={() => file.driveKey && onSelect(createDriveReferenceToken('file', file.driveKey, file.name))}
          />
          {!!file.children?.length && (
            <AgentPromptFileRows files={file.children} depth={depth + 1} onSelect={onSelect} />
          )}
        </div>
      ))}
    </>
  )
}

function AgentPromptToolRows({
  configuredTools,
  onConfiguredToolsChange,
  onSelect,
}: {
  configuredTools: AgentTool[]
  onConfiguredToolsChange: (tools: AgentTool[]) => void
  onSelect: (token: string) => void
}) {
  const { t } = useTranslation('agentV2')
  const language = useGetLanguage()
  const {
    getProviderIcon,
    getProviderIcons,
  } = useAgentPromptToolIconResolver()
  const [activeTab, setActiveTab] = useState<ToolPromptTab>('all')
  const [expandedProviderIds, setExpandedProviderIds] = useState<Set<string>>(() => new Set())
  const { data: builtInTools = [] } = useAllBuiltInTools()
  const { data: customTools = [] } = useAllCustomTools()
  const { data: workflowTools = [] } = useAllWorkflowTools()
  const { data: mcpTools = [] } = useAllMCPTools()
  const configuredCliTools = ENABLE_AGENT_CLI_TOOLS
    ? configuredTools.filter(tool => tool.kind === 'cli')
    : []
  const availableProviders = useMemo(() => {
    if (activeTab === 'all')
      return [...builtInTools, ...workflowTools, ...customTools, ...mcpTools]
    if (activeTab === ToolTabEnum.BuiltIn)
      return builtInTools
    if (activeTab === ToolTabEnum.Workflow)
      return workflowTools
    if (activeTab === ToolTabEnum.Custom)
      return customTools
    if (activeTab === ToolTabEnum.MCP)
      return mcpTools

    return []
  }, [activeTab, builtInTools, customTools, mcpTools, workflowTools])

  const selectedTools = useMemo(() => configuredTools.flatMap(toSelectedToolValue), [configuredTools])
  const tabs = [
    { key: 'all' as const, label: t('agentDetail.configure.tools.toolTabs.all') },
    { key: ToolTabEnum.BuiltIn, label: t('agentDetail.configure.tools.toolTabs.plugins') },
    { key: ToolTabEnum.Workflow, label: t('agentDetail.configure.tools.toolTabs.workflow') },
    { key: ToolTabEnum.Custom, label: t('agentDetail.configure.tools.toolTabs.custom') },
    { key: ToolTabEnum.MCP, label: t('agentDetail.configure.tools.toolTabs.mcp') },
    ...(ENABLE_AGENT_CLI_TOOLS
      ? [{ key: 'cli' as const, label: t('agentDetail.configure.tools.toolTabs.cli') }]
      : []),
  ]

  const selectTools = (tools: AgentProviderToolDefaultValue[]) => {
    onConfiguredToolsChange(addProviderTools(configuredTools, tools))
  }

  const toggleProvider = (providerId: string) => {
    setExpandedProviderIds((currentIds) => {
      const nextIds = new Set(currentIds)
      if (nextIds.has(providerId))
        nextIds.delete(providerId)
      else
        nextIds.add(providerId)

      return nextIds
    })
  }

  const handleSelectProvider = (provider: ToolWithProvider) => {
    const { icon, iconDark } = getProviderIcons(provider)
    selectTools(provider.tools.map(tool => toToolDefaultValue(provider, tool, language, icon, iconDark)))
    onSelect(createReferenceToken('tool', `${provider.id}/*`, getProviderLabel(provider, language)))
  }

  const handleSelectTool = (provider: ToolWithProvider, tool: Tool) => {
    const { icon, iconDark } = getProviderIcons(provider)
    const selectedTool = toToolDefaultValue(provider, tool, language, icon, iconDark)
    selectTools([selectedTool])
    onSelect(createReferenceToken('tool', `${provider.id}/${tool.name}`, selectedTool.tool_label))
  }

  return (
    <div>
      <div className="flex gap-1 px-2 py-1">
        {tabs.map(tab => (
          <button
            key={tab.key}
            type="button"
            className={cn(
              'flex h-6 shrink-0 items-center rounded-md px-2 system-xs-medium text-text-tertiary hover:bg-state-base-hover focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden',
              activeTab === tab.key && 'bg-state-base-active system-xs-semibold text-text-primary',
            )}
            onClick={() => setActiveTab(tab.key)}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <div className="max-h-[464px] overflow-y-auto px-1 pb-1">
        {activeTab === 'cli'
          ? configuredCliTools.map(tool => (
              <AgentPromptCliToolRow
                key={tool.id}
                tool={tool}
                onClick={() => onSelect(createReferenceToken('cli_tool', tool.id, tool.name))}
              />
            ))
          : availableProviders.filter(provider => provider.tools.length > 0).map(provider => (
              <div key={provider.id}>
                <AgentPromptProviderToolRow
                  provider={provider}
                  typeLabel={getProviderTypeLabel(provider, t)}
                  selectedTools={selectedTools}
                  language={language}
                  isExpanded={expandedProviderIds.has(provider.id)}
                  getProviderIcon={getProviderIcon}
                  onClick={() => handleSelectProvider(provider)}
                  onToggle={() => toggleProvider(provider.id)}
                />
                {expandedProviderIds.has(provider.id) && provider.tools.map(tool => (
                  <AgentPromptProviderToolActionRow
                    key={tool.name}
                    tool={tool}
                    language={language}
                    onClick={() => handleSelectTool(provider, tool)}
                  />
                ))}
              </div>
            ))}
      </div>
    </div>
  )
}

type ToolPromptTab = ToolTypeEnum | 'all' | 'cli'

function getLocalizedText(text: Record<string, string> | undefined | null, language: string) {
  if (!text)
    return ''

  return text[language]
    ?? text['en-US']
    ?? text.en_US
    ?? text.zh_Hans
    ?? Object.values(text).find(Boolean)
    ?? ''
}

function toSelectedToolValue(tool: AgentTool): ToolValue[] {
  if (tool.kind !== 'provider')
    return []

  return tool.actions.map(action => ({
    provider_name: tool.id,
    tool_name: action.toolName,
    tool_label: action.name,
    tool_description: action.description,
  }))
}

function toToolDefaultValue(
  provider: ToolWithProvider,
  tool: Tool,
  language: string,
  providerIcon: ToolWithProvider['icon'] | undefined,
  providerIconDark: ToolWithProvider['icon'] | undefined,
): AgentProviderToolDefaultValue {
  const params: Record<string, string> = {}
  tool.parameters?.forEach((parameter) => {
    params[parameter.name] = ''
  })

  const label = getLocalizedText(tool.label, language) || tool.name
  const description = getLocalizedText(tool.description, language)
  const providerLabel = getLocalizedText(provider.label, language) || provider.name

  return {
    provider_id: provider.id,
    provider_type: provider.type,
    provider_name: provider.name,
    provider_show_name: providerLabel,
    plugin_id: provider.plugin_id,
    plugin_unique_identifier: provider.plugin_unique_identifier,
    provider_icon: providerIcon,
    provider_icon_dark: providerIconDark,
    tool_name: tool.name,
    tool_label: label,
    tool_description: description,
    title: label,
    allowDelete: provider.allow_delete,
    is_team_authorization: provider.is_team_authorization,
    paramSchemas: tool.parameters,
    params,
    output_schema: tool.output_schema,
    meta: provider.meta,
  }
}

function isToolSelected(selectedTools: ToolValue[], provider: ToolWithProvider, tool: Tool) {
  return selectedTools.some(selectedTool =>
    (selectedTool.provider_name === provider.name || selectedTool.provider_name === provider.id)
    && selectedTool.tool_name === tool.name,
  )
}

function getProviderLabel(provider: ToolWithProvider, language: string) {
  return getLocalizedText(provider.label, language) || provider.name
}

function getProviderTypeLabel(
  provider: ToolWithProvider,
  t: ReturnType<typeof useTranslation>['t'],
) {
  if (provider.type === CollectionType.workflow)
    return t('agentDetail.configure.tools.toolTabs.workflow')
  if (provider.type === CollectionType.custom)
    return t('agentDetail.configure.tools.toolTabs.custom')
  if (provider.type === CollectionType.mcp)
    return t('agentDetail.configure.tools.toolTabs.mcp')

  return t('agentDetail.configure.tools.toolTabs.plugins')
}

function AgentPromptProviderToolRow({
  provider,
  typeLabel,
  selectedTools,
  language,
  isExpanded,
  getProviderIcon,
  onClick,
  onToggle,
}: {
  provider: ToolWithProvider
  typeLabel: string
  selectedTools: ToolValue[]
  language: string
  isExpanded: boolean
  getProviderIcon: (provider: ToolWithProvider) => ToolWithProvider['icon'] | undefined
  onClick: () => void
  onToggle: () => void
}) {
  const selectedToolsCount = provider.tools.filter(tool => isToolSelected(selectedTools, provider, tool)).length
  const providerLabel = getProviderLabel(provider, language)

  return (
    <div className="group flex h-7 w-full items-center gap-px overflow-hidden rounded-md">
      <button
        type="button"
        className="flex min-w-0 flex-1 items-center gap-1.5 rounded-l-md py-1 pr-1 pl-2 text-left group-hover:bg-state-base-hover focus-visible:bg-state-base-hover focus-visible:outline-hidden"
        onClick={onClick}
      >
        <AgentPromptProviderIcon provider={provider} getProviderIcon={getProviderIcon} />
        <span className="flex min-w-0 flex-1 items-center">
          <span className="min-w-0 truncate system-sm-regular text-text-secondary">{providerLabel}</span>
          {selectedToolsCount > 0 && selectedToolsCount < provider.tools.length && (
            <span className="ml-1.5 shrink-0 rounded-[5px] border border-divider-deep bg-components-badge-bg-dimm px-1 py-0.5 system-2xs-medium-uppercase text-text-tertiary">
              {selectedToolsCount}
            </span>
          )}
        </span>
        <span className="shrink-0 system-xs-regular text-text-quaternary">{typeLabel}</span>
      </button>
      <button
        type="button"
        aria-label={providerLabel}
        className="flex size-7 shrink-0 items-center justify-center rounded-r-md text-text-tertiary group-hover:bg-state-base-hover hover:bg-state-base-hover focus-visible:bg-state-base-hover focus-visible:outline-hidden"
        onClick={onToggle}
      >
        <span aria-hidden className={`${isExpanded ? 'i-ri-arrow-down-s-line' : 'i-ri-arrow-right-s-line'} size-4`} />
      </button>
    </div>
  )
}

function AgentPromptProviderIcon({
  provider,
  getProviderIcon,
}: {
  provider: ToolWithProvider
  getProviderIcon: (provider: ToolWithProvider) => ToolWithProvider['icon'] | undefined
}) {
  const icon = getProviderIcon(provider)

  return (
    <BlockIcon
      className="shrink-0"
      type={BlockEnum.Tool}
      size="sm"
      toolIcon={icon}
    />
  )
}

function AgentPromptToolFooter({
  onAddCliTool,
}: {
  onAddCliTool?: () => void
}) {
  const { t } = useTranslation()

  return (
    <div className="border-t border-divider-subtle p-1">
      <a
        href={getMarketplaceCategoryUrl(PluginCategoryEnum.tool)}
        target="_blank"
        rel="noreferrer"
        className="flex h-7 w-full items-center gap-1.5 rounded-md px-2 text-left hover:bg-state-base-hover focus-visible:bg-state-base-hover focus-visible:outline-hidden"
      >
        <span aria-hidden className="i-ri-store-2-line size-4 shrink-0 text-text-secondary" />
        <span className="system-sm-regular text-text-secondary">{t('findMoreInMarketplace', { ns: 'plugin' })}</span>
      </a>
      {onAddCliTool && (
        <button
          type="button"
          className="flex h-7 w-full items-center gap-1.5 rounded-md px-2 text-left hover:bg-state-base-hover focus-visible:bg-state-base-hover focus-visible:outline-hidden"
          onClick={onAddCliTool}
        >
          <span aria-hidden className="i-ri-add-line size-4 shrink-0 text-text-secondary" />
          <span className="system-sm-regular text-text-secondary">{t('agentDetail.configure.tools.cliDialog.title', { ns: 'agentV2' })}</span>
        </button>
      )}
    </div>
  )
}

function AgentPromptProviderToolActionRow({
  tool,
  language,
  onClick,
}: {
  tool: Tool
  language: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      className="flex h-6 w-full items-center gap-1 rounded-md text-left hover:bg-state-base-hover focus-visible:bg-state-base-hover focus-visible:outline-hidden"
      onClick={onClick}
    >
      <span className="ml-4 h-full w-px shrink-0 bg-divider-subtle" />
      <span className="flex min-w-0 flex-1 items-center gap-1 py-1 pr-2 pl-3">
        <span className="min-w-0 flex-1 truncate system-sm-regular text-text-secondary">
          {getLocalizedText(tool.label, language) || tool.name}
        </span>
      </span>
    </button>
  )
}

function AgentPromptCliToolRow({
  tool,
  onClick,
}: {
  tool: Extract<AgentTool, { kind: 'cli' }>
  onClick: () => void
}) {
  const { t } = useTranslation('agentV2')

  return (
    <button
      type="button"
      className="flex h-7 w-full items-center gap-1 rounded-md text-left hover:bg-state-base-hover focus-visible:bg-state-base-hover focus-visible:outline-hidden"
      onClick={onClick}
    >
      <span className="flex min-w-0 flex-1 items-center gap-1.5 py-1 pr-8 pl-2">
        <span className="flex size-5 shrink-0 items-center justify-center rounded-md border-[0.5px] border-effects-icon-border bg-background-default-dodge">
          <span aria-hidden className="i-ri-terminal-box-line size-3.5 text-text-tertiary" />
        </span>
        <span className="min-w-0 flex-1 truncate system-sm-regular text-text-secondary">{tool.name}</span>
        <span className="shrink-0 system-xs-regular text-text-quaternary">
          {t('agentDetail.configure.tools.toolTabs.cli')}
        </span>
      </span>
    </button>
  )
}

function AgentPromptKnowledgeRows({
  retrievals,
  onSelect,
}: {
  retrievals: AgentKnowledgeRetrievalItem[]
  onSelect: (token: string) => void
}) {
  const { t } = useTranslation('agentV2')

  return (
    <>
      {retrievals.map(retrieval => (
        <AgentPromptSubmenuRow
          key={retrieval.id}
          icon="i-ri-book-open-line"
          label={getKnowledgeRetrievalName(retrieval, t)}
          onClick={() => onSelect(createReferenceToken('knowledge', retrieval.id, getKnowledgeRetrievalName(retrieval, t)))}
        />
      ))}
    </>
  )
}

function getKnowledgeRetrievalName(
  retrieval: AgentKnowledgeRetrievalItem,
  t: ReturnType<typeof useTranslation>['t'],
) {
  return retrieval.name ?? (retrieval.nameKey ? t(retrieval.nameKey) : retrieval.id)
}

function AgentPromptSubmenuRow({
  icon,
  label,
  depth = 0,
  hasChildren = false,
  onClick,
}: {
  icon?: ReactNode
  label: string
  depth?: number
  hasChildren?: boolean
  onClick: () => void
}) {
  const indent = depth === 0 ? 'pl-3' : depth === 1 ? 'pl-8' : 'pl-12'

  return (
    <button
      type="button"
      className="flex h-6 w-full items-center gap-1 rounded-md text-left hover:bg-state-base-hover focus-visible:bg-state-base-hover focus-visible:outline-hidden"
      onClick={onClick}
    >
      <span className={`flex min-w-0 flex-1 items-center gap-1 ${indent} pr-2`}>
        {typeof icon === 'string' && <span aria-hidden className={`${icon} size-4 shrink-0 text-text-secondary`} />}
        {typeof icon !== 'string' && icon}
        <span className="min-w-0 flex-1 truncate system-sm-regular text-text-secondary">{label}</span>
      </span>
      {hasChildren && <span aria-hidden className="mr-1.5 i-ri-arrow-right-s-line size-4 shrink-0 text-text-tertiary" />}
    </button>
  )
}
