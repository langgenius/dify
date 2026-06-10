'use client'

import type { I18nKeysWithPrefix } from '@/types/i18n'
import { cn } from '@langgenius/dify-ui/cn'
import { Tooltip, TooltipContent, TooltipTrigger } from '@langgenius/dify-ui/tooltip'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

type AgentToolBase = {
  id: string
  name: string
}

type AgentProviderTool = AgentToolBase & {
  kind: 'provider'
  iconClassName: string
  credentialKey: I18nKeysWithPrefix<'agentV2', 'agentDetail.configure.tools.'>
  credentialVariant: 'authorized' | 'endUser'
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
  },
  {
    id: 'web-search',
    name: 'Web Search',
    kind: 'provider',
    iconClassName: 'i-ri-search-line text-[#ef3d32]',
    credentialKey: 'agentDetail.configure.tools.credential.endUserOAuth',
    credentialVariant: 'endUser',
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
}: {
  tool: AgentProviderTool
}) {
  return (
    <div className="flex min-h-8 items-center gap-1 overflow-hidden rounded-lg border-[0.5px] border-components-panel-border bg-components-panel-on-panel-item-bg p-1 shadow-xs shadow-shadow-shadow-3">
      <div className="flex min-w-0 flex-1 items-center gap-2 rounded-lg py-0.5 pr-1 pl-1">
        <ProviderIcon iconClassName={tool.iconClassName} />
        <div className="flex min-w-0 items-center">
          <span className="min-w-0 truncate system-sm-medium text-text-primary">
            {tool.name}
          </span>
          <span aria-hidden className="i-custom-vender-solid-arrows-arrow-down-round-fill size-4 shrink-0 -rotate-90 text-text-quaternary" />
        </div>
      </div>
      <CredentialStatus credentialKey={tool.credentialKey} variant={tool.credentialVariant} />
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
}: {
  tool: AgentTool
}) {
  if (tool.kind === 'provider')
    return <AgentProviderToolItem tool={tool} />

  return <AgentCliToolItem tool={tool} />
}

export function AgentTools({
  tools = defaultTools,
}: {
  tools?: AgentTool[]
}) {
  const { t } = useTranslation('agentV2')
  const [isExpanded, setIsExpanded] = useState(true)
  const toolsTip = t('agentDetail.configure.tools.tip')
  const toolsListId = 'agent-configure-tools-list'

  return (
    <section className={cn('border-b border-divider-subtle pt-4', isExpanded && 'pb-4')} aria-labelledby="agent-configure-tools-label">
      <div className="mb-2 flex min-h-6 items-center gap-2">
        <div className="flex min-w-0 flex-1 items-center gap-0.5">
          <h3
            id="agent-configure-tools-label"
            className="truncate system-sm-semibold-uppercase text-text-secondary"
          >
            {t('agentDetail.configure.tools.label')}
          </h3>
          <Tooltip>
            <TooltipTrigger
              render={(
                <button
                  type="button"
                  aria-label={toolsTip}
                  className="flex size-4 shrink-0 items-center justify-center rounded-sm text-text-quaternary hover:text-text-tertiary focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden"
                >
                  <span aria-hidden className="i-ri-question-line size-3.5" />
                </button>
              )}
            />
            <TooltipContent placement="top" className="max-w-64">
              {toolsTip}
            </TooltipContent>
          </Tooltip>
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
            <AgentToolItem key={tool.id} tool={tool} />
          ))}
        </div>
      )}
    </section>
  )
}
