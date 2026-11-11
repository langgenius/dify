import type { ExternalAgentWorkflowPreviewAgent } from './types'
import { Button } from '@langgenius/dify-ui/button'
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from '@langgenius/dify-ui/popover'
import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import AppIcon from '@/app/components/base/app-icon'
import { SearchInput } from '@/app/components/base/search-input'
import { externalWorkflowAgentExamples } from '@/app/components/workflow/block-selector/workflow-agent-selector-preview'
import { ExternalAgentBadge } from './external-badge'

export function ExternalAgentField({
  agent,
  onChange,
}: {
  agent: ExternalAgentWorkflowPreviewAgent
  onChange: (agent: ExternalAgentWorkflowPreviewAgent) => void
}) {
  const { t } = useTranslation(['workflow', 'workflowAgent', 'agentRoster'])
  const labelId = useId()
  const [open, setOpen] = useState(false)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <div role="group" aria-labelledby={labelId} className="px-4 pt-4 pb-2">
        <div className="mb-1 flex h-6 items-center justify-between gap-2">
          <span id={labelId} className="system-sm-semibold-uppercase text-text-secondary">
            {t(($) => $['nodes.agent.roster.label'], { ns: 'workflow' })}
          </span>
          <PopoverTrigger
            render={<Button variant="ghost" size="small" className="text-text-tertiary" />}
          >
            {t(($) => $['nodes.agent.roster.change'], { ns: 'workflowAgent' })}
          </PopoverTrigger>
        </div>
        <PopoverTrigger
          render={
            <Button
              variant="ghost"
              className="h-8 w-full justify-start gap-1 rounded-lg bg-components-input-bg-normal p-1 text-start hover:bg-state-base-hover-alt"
            />
          }
        >
          <span className="flex size-6 shrink-0 items-center justify-center">
            <AppIcon
              size="tiny"
              className="size-5 rounded-md"
              icon={agent.icon}
              fallback={{
                content: (
                  <span aria-hidden className="i-ri-robot-2-line size-3.5 text-text-accent" />
                ),
                background: 'var(--color-background-default)',
              }}
            />
          </span>
          <span className="truncate system-sm-regular text-components-input-text-filled">
            {agent.name}
          </span>
          <ExternalAgentBadge />
          <span
            aria-hidden
            className="ms-auto me-1 i-ri-arrow-right-s-line size-4 shrink-0 text-text-tertiary"
          />
        </PopoverTrigger>
      </div>
      <PopoverContent align="start" className="w-100 max-w-[calc(100vw-2rem)] p-1">
        <PopoverTitle className="sr-only">
          {t(($) => $['roster.nodeSelector.dialogLabel'], { ns: 'agentRoster' })}
        </PopoverTitle>
        <ExternalAgentOptions
          onSelect={(next) => {
            onChange(next)
            setOpen(false)
          }}
        />
      </PopoverContent>
    </Popover>
  )
}

function ExternalAgentOptions({
  onSelect,
}: {
  onSelect: (agent: ExternalAgentWorkflowPreviewAgent) => void
}) {
  const { t } = useTranslation(['agentRoster'])
  const [search, setSearch] = useState('')
  const agents = externalWorkflowAgentExamples.filter((agent) =>
    agent.name.toLowerCase().includes(search.trim().toLowerCase()),
  )
  return (
    <div>
      <div className="p-1">
        <SearchInput
          value={search}
          onValueChange={setSearch}
          aria-label={t(($) => $['roster.searchLabel'])}
          placeholder={t(($) => $['roster.nodeSelector.searchAgentsPlaceholder'])}
        />
      </div>
      <div className="flex max-h-60 flex-col overflow-y-auto p-1">
        {agents.map((agent) => (
          <Button
            key={agent.key}
            variant="ghost"
            disabled={!agent.enabled}
            className="h-8 w-full shrink-0 justify-start gap-2"
            onClick={() => onSelect(agent)}
          >
            <AppIcon size="tiny" icon={agent.icon} />
            <span className="truncate system-sm-medium">{agent.name}</span>
            <span className="system-xs-regular text-text-quaternary">
              {agent.enabled
                ? t(($) => $['roster.nodeSelector.source.external'])
                : t(($) => $['external.filters.disabled'])}
            </span>
          </Button>
        ))}
        {agents.length === 0 && (
          <p role="status" className="p-3 system-sm-regular text-text-tertiary">
            {t(($) => $['roster.emptySearch'])}
          </p>
        )}
      </div>
    </div>
  )
}
