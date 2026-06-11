'use client'

import type { Tool, ToolParameter } from '@/app/components/tools/types'
import type { ToolWithProvider } from '@/app/components/workflow/types'
import type { I18nKeysWithPrefix } from '@/types/i18n'
import { cn } from '@langgenius/dify-ui/cn'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import SettingBuiltInTool from '@/app/components/app/configuration/config/agent/agent-tools/setting-built-in-tool'
import { Infotip } from '@/app/components/base/infotip'
import { CollectionType } from '@/app/components/tools/types'

type AgentToolBase = {
  id: string
  name: string
}

type AgentToolAction = {
  id: string
  name: string
  toolName: string
  description: string
}

type AgentProviderTool = AgentToolBase & {
  kind: 'provider'
  iconClassName: string
  credentialKey: I18nKeysWithPrefix<'agentV2', 'agentDetail.configure.tools.'>
  credentialVariant: 'authorized' | 'endUser'
  actions: AgentToolAction[]
}

type AgentCliTool = AgentToolBase & {
  kind: 'cli'
  action?: 'preAuthorize'
}

export type AgentTool = AgentProviderTool | AgentCliTool

const defaultTools: AgentTool[] = [
  {
    id: 'duckduckgo',
    name: 'DuckDuckGo',
    kind: 'provider',
    iconClassName: 'i-custom-public-other-default-tool-icon text-[#ef5b39]',
    credentialKey: 'agentDetail.configure.tools.credential.authOne',
    credentialVariant: 'authorized',
    actions: [
      {
        id: 'duckduckgo-ai-chat',
        name: 'DuckDuckGo AI Chat',
        toolName: 'duckduckgo_ai_chat',
        description: 'Chat with DuckDuckGo AI for lightweight web answers.',
      },
      {
        id: 'duckduckgo-image-search',
        name: 'DuckDuckGo Image Search',
        toolName: 'duckduckgo_image_search',
        description: 'Search DuckDuckGo images and return matching image results.',
      },
      {
        id: 'duckduckgo-search',
        name: 'DuckDuckGo Search',
        toolName: 'duckduckgo_search',
        description: 'Search DuckDuckGo and return relevant webpage snippets.',
      },
      {
        id: 'duckduckgo-translate',
        name: 'DuckDuckGo Translate',
        toolName: 'duckduckgo_translate',
        description: 'Translate short text with DuckDuckGo translation tools.',
      },
    ],
  },
  {
    id: 'web-search',
    name: 'Web Search',
    kind: 'provider',
    iconClassName: 'i-ri-search-line text-[#ef3d32]',
    credentialKey: 'agentDetail.configure.tools.credential.endUserOAuth',
    credentialVariant: 'endUser',
    actions: [
      {
        id: 'web-search-query',
        name: 'Search',
        toolName: 'web_search',
        description: 'Search the web and return relevant result snippets.',
      },
      {
        id: 'web-search-read',
        name: 'Read webpage',
        toolName: 'read_webpage',
        description: 'Read and summarize content from a webpage URL.',
      },
    ],
  },
  {
    id: 'lark-cli-badge',
    name: 'Lark CLI',
    kind: 'cli',
  },
  {
    id: 'lark-cli-action',
    name: 'Lark CLI',
    kind: 'cli',
    action: 'preAuthorize',
  },
]

type ToolSettingTarget = {
  action: AgentToolAction
  tool: AgentProviderTool
}

const localize = (value: string) => ({
  en_US: value,
  zh_Hans: value,
})

const mockSettingParameter = (name: string): ToolParameter => ({
  name,
  label: localize(name === 'used_in_agent_nodes' ? 'Used in Agent nodes' : 'Query'),
  human_description: localize(name === 'used_in_agent_nodes'
    ? 'Whether this tool can be used by agent nodes.'
    : 'The input query passed to this tool.'),
  type: name === 'used_in_agent_nodes' ? 'boolean' : 'string',
  form: name === 'used_in_agent_nodes' ? 'form' : 'llm',
  llm_description: name === 'used_in_agent_nodes'
    ? 'Whether this tool can be used by agent nodes.'
    : 'Search query or URL input for the tool.',
  required: name !== 'used_in_agent_nodes',
  multiple: false,
  default: '',
})

const createToolCollection = (tool: AgentProviderTool): ToolWithProvider => ({
  id: tool.id,
  name: tool.id,
  author: tool.name,
  description: localize(`${tool.name} tools`),
  icon: '',
  label: localize(tool.name),
  type: CollectionType.builtIn,
  team_credentials: {},
  is_team_authorization: true,
  allow_delete: false,
  labels: [],
  meta: {
    version: '0.0.0',
  },
  tools: tool.actions.map<Tool>(action => ({
    name: action.toolName,
    author: tool.name,
    label: localize(action.name),
    description: localize(action.description),
    parameters: [
      mockSettingParameter('used_in_agent_nodes'),
      mockSettingParameter('query'),
    ],
    labels: [],
    output_schema: {},
  })),
}) as ToolWithProvider

function ProviderIcon({
  iconClassName,
}: {
  iconClassName: string
}) {
  return (
    <span className="flex size-5 shrink-0 items-center justify-center rounded-md border-[0.5px] border-effects-icon-border bg-background-default-dodge">
      <span aria-hidden className={cn('size-3.5', iconClassName)} />
    </span>
  )
}

function CliIcon() {
  return (
    <span className="flex size-5 shrink-0 items-center justify-center rounded-md border border-divider-regular bg-text-tertiary p-1 text-text-primary-on-surface">
      <span aria-hidden className="i-ri-terminal-box-line size-3.5" />
    </span>
  )
}

function CredentialStatus({
  credentialKey,
  variant,
}: {
  credentialKey: I18nKeysWithPrefix<'agentV2', 'agentDetail.configure.tools.'>
  variant: AgentProviderTool['credentialVariant']
}) {
  const { t } = useTranslation('agentV2')

  return (
    <button
      type="button"
      className="flex shrink-0 items-center justify-center rounded-md px-1.5 py-1 text-text-secondary hover:bg-state-base-hover focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden"
    >
      {variant === 'authorized'
        ? <span aria-hidden className="mr-1 size-2 rounded-[3px] border border-components-badge-status-light-success-border-inner bg-components-badge-status-light-success-bg shadow-status-indicator-green-shadow" />
        : <span aria-hidden className="mr-1 i-ri-user-settings-line size-3.5 text-text-secondary" />}
      <span className="truncate system-xs-medium">{t(credentialKey)}</span>
      <span aria-hidden className="ml-0.5 i-custom-vender-solid-arrows-arrow-down-round-fill size-3.5 text-text-tertiary" />
    </button>
  )
}

function AgentProviderToolItem({
  tool,
  isExpanded,
  onToggle,
  onConfigureAction,
}: {
  tool: AgentProviderTool
  isExpanded: boolean
  onToggle: () => void
  onConfigureAction: (target: ToolSettingTarget) => void
}) {
  const { t } = useTranslation('agentV2')

  return (
    <div className="flex flex-col overflow-hidden rounded-lg border-[0.5px] border-components-panel-border bg-components-panel-on-panel-item-bg p-1 shadow-xs shadow-shadow-shadow-3">
      <div className="flex min-h-7 items-center gap-1 rounded-lg py-0.5 pr-0.5 pl-1">
        <button
          type="button"
          aria-expanded={isExpanded}
          onClick={onToggle}
          className="flex min-w-0 flex-1 items-center gap-2 rounded-md pr-1 text-left focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden"
        >
          <ProviderIcon iconClassName={tool.iconClassName} />
          <span className="flex min-w-0 items-center">
            <span className="min-w-0 truncate system-sm-medium text-text-primary">
              {tool.name}
            </span>
            <span
              aria-hidden
              className={cn(
                'i-custom-vender-solid-arrows-arrow-down-round-fill size-4 shrink-0 text-text-quaternary transition-transform',
                !isExpanded && '-rotate-90',
              )}
            />
          </span>
        </button>
        <CredentialStatus credentialKey={tool.credentialKey} variant={tool.credentialVariant} />
      </div>

      {isExpanded && (
        <div className="flex flex-col">
          {tool.actions.map(action => (
            <div
              key={action.id}
              className="group relative flex min-h-7 items-center gap-1 rounded-md py-px pr-0 pl-1 hover:bg-state-base-hover"
            >
              <div className="absolute top-0 bottom-0 left-[13.5px] w-px bg-divider-regular" />
              <div className="flex min-w-0 flex-1 items-center py-1 pl-7">
                <span className="min-w-0 flex-1 truncate system-sm-regular text-text-secondary">
                  {action.name}
                </span>
              </div>
              <div className="hidden shrink-0 items-center gap-1 px-0.5 group-focus-within:flex group-hover:flex">
                <button
                  type="button"
                  aria-label={t('agentDetail.configure.tools.editAction', { name: action.name })}
                  onClick={() => onConfigureAction({ action, tool })}
                  className="flex size-6 items-center justify-center rounded-md text-text-tertiary hover:bg-state-base-hover hover:text-text-secondary focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden"
                >
                  <span aria-hidden className="i-ri-equalizer-2-line size-4" />
                </button>
                <button
                  type="button"
                  aria-label={t('agentDetail.configure.tools.removeAction', { name: action.name })}
                  className="flex size-6 items-center justify-center rounded-md text-text-tertiary hover:bg-state-destructive-hover hover:text-text-destructive focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden"
                >
                  <span aria-hidden className="i-ri-delete-bin-line size-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function AgentCliToolItem({
  tool,
}: {
  tool: AgentCliTool
}) {
  const { t } = useTranslation('agentV2')

  return (
    <div className="flex min-h-8 items-center gap-1 overflow-hidden rounded-lg border-[0.5px] border-components-panel-border-subtle bg-components-panel-on-panel-item-bg py-1.5 pr-2 pl-2 shadow-xs shadow-shadow-shadow-3">
      <div className="flex min-w-0 flex-1 items-center gap-2 pr-1">
        <CliIcon />
        <span className="min-w-0 truncate system-sm-medium text-text-primary">
          {tool.name}
        </span>
      </div>
      {tool.action === 'preAuthorize'
        ? (
            <div className="flex shrink-0 items-center gap-1">
              <button
                type="button"
                className="flex items-center justify-center rounded-md px-1.5 py-1 text-text-tertiary hover:bg-state-base-hover hover:text-text-secondary focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden"
              >
                <span aria-hidden className="mr-1 i-ri-key-2-line size-3.5" />
                <span className="system-xs-medium">{t('agentDetail.configure.tools.preAuthorize')}</span>
              </button>
              <button
                type="button"
                aria-label={t('agentDetail.configure.tools.moreActions', { name: tool.name })}
                className="flex size-6 items-center justify-center rounded-md text-text-tertiary hover:bg-state-base-hover hover:text-text-secondary focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden"
              >
                <span aria-hidden className="i-ri-more-fill size-4" />
              </button>
            </div>
          )
        : (
            <span className="shrink-0 rounded-[5px] border border-divider-deep bg-components-badge-bg-dimm px-1 py-0.5 system-2xs-medium-uppercase text-text-tertiary">
              {t('agentDetail.configure.tools.cliTool')}
            </span>
          )}
    </div>
  )
}

function AgentToolItem({
  tool,
  isExpanded,
  onToggle,
  onConfigureAction,
}: {
  tool: AgentTool
  isExpanded: boolean
  onToggle: () => void
  onConfigureAction: (target: ToolSettingTarget) => void
}) {
  if (tool.kind === 'provider')
    return <AgentProviderToolItem tool={tool} isExpanded={isExpanded} onToggle={onToggle} onConfigureAction={onConfigureAction} />

  return <AgentCliToolItem tool={tool} />
}

export function AgentTools({
  tools = defaultTools,
}: {
  tools?: AgentTool[]
}) {
  const { t } = useTranslation('agentV2')
  const [isExpanded, setIsExpanded] = useState(true)
  const [expandedToolIds, setExpandedToolIds] = useState<Set<string>>(() => new Set())
  const [toolSettings, setToolSettings] = useState<Record<string, Record<string, unknown>>>({})
  const [settingTarget, setSettingTarget] = useState<ToolSettingTarget | null>(null)
  const toolsTip = t('agentDetail.configure.tools.tip')
  const toolsListId = 'agent-configure-tools-list'
  const toggleTool = (tool: AgentTool) => {
    if (tool.kind === 'cli')
      return

    setExpandedToolIds((currentIds) => {
      const nextIds = new Set(currentIds)
      if (nextIds.has(tool.id))
        nextIds.delete(tool.id)
      else
        nextIds.add(tool.id)

      return nextIds
    })
  }
  const currentSettingCollection = settingTarget ? createToolCollection(settingTarget.tool) : null
  const currentSettingValue = settingTarget ? toolSettings[settingTarget.action.id] : undefined

  return (
    <>
      <section className={cn('border-b border-divider-subtle pt-4', isExpanded && 'pb-4')} aria-labelledby="agent-configure-tools-label">
        <div className="mb-2 flex min-h-6 items-center gap-2">
          <div className="flex min-w-0 flex-1 items-center gap-0.5">
            <h3
              id="agent-configure-tools-label"
              className="truncate system-sm-semibold-uppercase text-text-secondary"
            >
              {t('agentDetail.configure.tools.label')}
            </h3>
            <Infotip aria-label={toolsTip} popupClassName="max-w-64">
              {toolsTip}
            </Infotip>
            <button
              type="button"
              aria-label={t('agentDetail.configure.tools.toggle')}
              aria-controls={toolsListId}
              aria-expanded={isExpanded}
              onClick={() => setIsExpanded(expanded => !expanded)}
              className="flex size-4 shrink-0 items-center justify-center rounded-sm text-text-quaternary hover:text-text-tertiary focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden"
            >
              <span
                aria-hidden
                className={`i-custom-vender-solid-arrows-arrow-down-round-fill size-4 transition-transform ${isExpanded ? '' : '-rotate-90'}`}
              />
            </button>
          </div>

          <button
            type="button"
            aria-label={t('agentDetail.configure.tools.add')}
            className="flex size-6 shrink-0 items-center justify-center rounded-md text-text-tertiary hover:bg-state-base-hover hover:text-text-secondary focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden"
          >
            <span aria-hidden className="i-ri-add-line size-4" />
          </button>
        </div>

        {isExpanded && (
          <div id={toolsListId} className="flex flex-col gap-1">
            {tools.map(tool => (
              <AgentToolItem
                key={tool.id}
                tool={tool}
                isExpanded={tool.kind === 'provider' && expandedToolIds.has(tool.id)}
                onToggle={() => toggleTool(tool)}
                onConfigureAction={setSettingTarget}
              />
            ))}
          </div>
        )}
      </section>
      {settingTarget && currentSettingCollection && (
        <SettingBuiltInTool
          toolName={settingTarget.action.toolName}
          setting={currentSettingValue}
          collection={currentSettingCollection}
          isModel={false}
          onSave={(value) => {
            setToolSettings(currentSettings => ({
              ...currentSettings,
              [settingTarget.action.id]: value,
            }))
            setSettingTarget(null)
          }}
          onHide={() => setSettingTarget(null)}
        />
      )}
    </>
  )
}
