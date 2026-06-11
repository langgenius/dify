'use client'

import type { Tool, ToolParameter } from '@/app/components/tools/types'
import type { ToolWithProvider } from '@/app/components/workflow/types'
import type { I18nKeysWithPrefix } from '@/types/i18n'
import { cn } from '@langgenius/dify-ui/cn'
import {
  CollapsiblePanel,
  CollapsibleRoot,
  CollapsibleTrigger,
} from '@langgenius/dify-ui/collapsible'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import SettingBuiltInTool from '@/app/components/app/configuration/config/agent/agent-tools/setting-built-in-tool'
import { CollectionType } from '@/app/components/tools/types'
import { ConfigureSection } from '../configure-section'
import { ConfigureSectionAddButton } from '../configure-section-add-button'
import { defaultAgentTools } from '../configured-data'

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
  onOpenChange,
  onConfigureAction,
}: {
  tool: AgentProviderTool
  isExpanded: boolean
  onOpenChange: (open: boolean) => void
  onConfigureAction: (target: ToolSettingTarget) => void
}) {
  const { t } = useTranslation('agentV2')

  return (
    <CollapsibleRoot
      open={isExpanded}
      onOpenChange={onOpenChange}
      className="overflow-hidden rounded-lg border-[0.5px] border-components-panel-border bg-components-panel-on-panel-item-bg p-1 shadow-xs shadow-shadow-shadow-3"
    >
      <div className="flex min-h-7 items-center gap-1 rounded-lg py-0.5 pr-0.5 pl-1">
        <CollapsibleTrigger
          className="group min-h-0 min-w-0 flex-1 justify-start gap-2 rounded-md px-0 pr-1 text-left hover:not-data-disabled:bg-transparent hover:not-data-disabled:text-text-secondary data-panel-open:text-text-secondary"
        >
          <ProviderIcon iconClassName={tool.iconClassName} />
          <span className="flex min-w-0 items-center">
            <span className="min-w-0 truncate system-sm-medium text-text-primary">
              {tool.name}
            </span>
            <span
              aria-hidden
              className={cn(
                'i-custom-vender-solid-arrows-arrow-down-round-fill size-4 shrink-0 -rotate-90 text-text-quaternary transition-transform group-data-panel-open:rotate-0 motion-reduce:transition-none',
              )}
            />
          </span>
        </CollapsibleTrigger>
        <CredentialStatus credentialKey={tool.credentialKey} variant={tool.credentialVariant} />
      </div>

      <CollapsiblePanel>
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
      </CollapsiblePanel>
    </CollapsibleRoot>
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
  onOpenChange,
  onConfigureAction,
}: {
  tool: AgentTool
  isExpanded: boolean
  onOpenChange: (open: boolean) => void
  onConfigureAction: (target: ToolSettingTarget) => void
}) {
  if (tool.kind === 'provider')
    return <AgentProviderToolItem tool={tool} isExpanded={isExpanded} onOpenChange={onOpenChange} onConfigureAction={onConfigureAction} />

  return <AgentCliToolItem tool={tool} />
}

export function AgentTools({
  tools = defaultAgentTools,
}: {
  tools?: AgentTool[]
}) {
  const { t } = useTranslation('agentV2')
  const [expandedToolIds, setExpandedToolIds] = useState<Set<string>>(() => new Set())
  const [toolSettings, setToolSettings] = useState<Record<string, Record<string, unknown>>>({})
  const [settingTarget, setSettingTarget] = useState<ToolSettingTarget | null>(null)
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
  const currentSettingCollection = settingTarget ? createToolCollection(settingTarget.tool) : null
  const currentSettingValue = settingTarget ? toolSettings[settingTarget.action.id] : undefined

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
          <ConfigureSectionAddButton ariaLabel={t('agentDetail.configure.tools.add')} />
        )}
      >
        {tools.map(tool => (
          <AgentToolItem
            key={tool.id}
            tool={tool}
            isExpanded={tool.kind === 'provider' && expandedToolIds.has(tool.id)}
            onOpenChange={open => setToolOpen(tool, open)}
            onConfigureAction={setSettingTarget}
          />
        ))}
      </ConfigureSection>
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
