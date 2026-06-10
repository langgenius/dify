import type { NodePanelProps } from '../../types'
import type { AgentNodeType } from './types'
import type { AgentRosterNodeData } from '@/app/components/workflow/block-selector/types'
import { AvatarFallback, AvatarImage, AvatarRoot } from '@langgenius/dify-ui/avatar'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { FieldLabel, FieldRoot } from '@langgenius/dify-ui/field'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { getAgentDetailPath } from '@/features/agent-v2/agent-detail/routes'
import Link from '@/next/link'
import OutputVars, { VarItem } from '../_base/components/output-vars'

const i18nPrefix = 'nodes.agent'

function AgentRosterAvatar({
  agent,
  size = 'lg',
  className,
}: {
  agent: AgentRosterNodeData
  size?: 'xs' | 'md' | 'lg'
  className?: string
}) {
  const imageUrl = (agent.icon_type === 'image' || agent.icon_type === 'link') ? agent.icon : undefined

  return (
    <AvatarRoot
      size={size}
      className={cn('border-[0.5px] border-divider-regular', className)}
      style={{ background: imageUrl ? undefined : (agent.icon_background || '#FFEAD5') }}
    >
      {imageUrl && (
        <AvatarImage
          src={imageUrl}
          alt={agent.name}
        />
      )}
      <AvatarFallback size={size} className="text-text-primary-on-surface">
        {agent.icon_type === 'emoji' && agent.icon ? agent.icon : agent.name[0]?.toLocaleUpperCase()}
      </AvatarFallback>
    </AvatarRoot>
  )
}

function AgentRosterLayeredPanel({
  agent,
  onClose,
}: {
  agent: AgentRosterNodeData
  onClose: () => void
}) {
  const { t } = useTranslation()
  const titleId = `agent-roster-panel-${agent.id}`

  return (
    <section
      role="dialog"
      aria-modal="false"
      aria-labelledby={titleId}
      className="fixed top-14 bottom-1 z-40 flex flex-col overflow-hidden rounded-2xl border-[0.5px] border-divider-subtle bg-components-panel-bg text-text-primary shadow-2xl shadow-shadow-shadow-5 outline-hidden"
      style={{
        right: 'var(--workflow-node-panel-right, 4px)',
        width: 'var(--workflow-node-panel-width, 400px)',
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.stopPropagation()
          onClose()
        }
      }}
    >
      <header className="flex shrink-0 flex-col gap-3 border-b border-divider-subtle bg-components-panel-bg py-3 pr-4 pl-3">
        <div className="flex min-w-0 items-start justify-between">
          <div className="flex min-w-0 flex-1 items-center gap-2 px-1 py-0.5">
            <AgentRosterAvatar agent={agent} size="md" className="size-8" />
            <div className="flex min-w-0 flex-1 flex-col gap-0.5 py-px">
              <div className="flex min-w-0 items-center gap-1">
                <h2 id={titleId} className="truncate system-sm-medium text-text-secondary">
                  {agent.name}
                </h2>
                <span aria-hidden className="i-ri-lock-line size-3 shrink-0 text-text-tertiary" />
              </div>
              <p className="truncate system-xs-regular text-text-tertiary">
                {agent.description}
              </p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1 py-1">
            <button
              type="button"
              aria-label={t(`${i18nPrefix}.roster.more`, { ns: 'workflow' })}
              className="flex size-6 cursor-pointer items-center justify-center rounded-md text-text-tertiary hover:bg-state-base-hover focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden"
            >
              <span aria-hidden className="i-ri-more-fill size-4" />
            </button>
            <div className="flex h-3.5 items-start px-1">
              <div className="h-full w-px bg-divider-regular" />
            </div>
            <button
              type="button"
              autoFocus
              aria-label={t('operation.close', { ns: 'common' })}
              className="flex size-6 cursor-pointer items-center justify-center rounded-md text-text-tertiary hover:bg-state-base-hover focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden"
              onClick={onClose}
            >
              <span aria-hidden className="i-ri-close-line size-4" />
            </button>
          </div>
        </div>
        <div className="flex gap-2 pl-1">
          <Link
            href={getAgentDetailPath(agent.id, 'configure')}
            className="inline-flex h-8 min-w-0 flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-lg border-[0.5px] border-components-button-secondary-border bg-components-button-secondary-bg px-3 text-[13px] leading-4 font-medium whitespace-nowrap text-components-button-secondary-text shadow-xs outline-hidden backdrop-blur-[5px] hover:border-components-button-secondary-border-hover hover:bg-components-button-secondary-bg-hover focus-visible:ring-2 focus-visible:ring-state-accent-solid"
          >
            <span aria-hidden className="i-ri-external-link-line size-4 shrink-0" />
            <span className="truncate">
              {t(`${i18nPrefix}.roster.editInConsole`, { ns: 'workflow' })}
            </span>
          </Link>
          <Button
            variant="secondary"
            size="medium"
            className="min-w-0 flex-1 gap-1.5 px-3"
          >
            <span aria-hidden className="i-ri-file-copy-2-line size-4 shrink-0" />
            <span className="truncate">
              {t(`${i18nPrefix}.roster.makeCopy`, { ns: 'workflow' })}
            </span>
          </Button>
        </div>
      </header>
      <div
        role="region"
        aria-label={t(`${i18nPrefix}.roster.panelLabel`, { ns: 'workflow', name: agent.name })}
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain"
      >
        <div className="h-full min-h-80 bg-components-panel-bg" />
      </div>
    </section>
  )
}

function AgentRosterField({
  agent,
}: {
  agent?: AgentRosterNodeData
}) {
  const { t } = useTranslation()
  const [isPanelOpen, setIsPanelOpen] = useState(false)

  if (!agent)
    return null

  return (
    <FieldRoot name="agent_roster" className="gap-1 px-4 py-2">
      <div className="flex h-6 items-center gap-2">
        <FieldLabel className="min-w-0 flex-1 py-1 system-sm-semibold-uppercase">
          {t('nodes.agent.roster.label', { ns: 'workflow' })}
        </FieldLabel>
        <button
          type="button"
          className="flex h-6 shrink-0 cursor-pointer items-center justify-center rounded-md px-1.5 py-1 system-xs-medium text-text-tertiary hover:bg-state-base-hover hover:text-text-secondary focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden"
          onClick={() => setIsPanelOpen(true)}
        >
          {t(`${i18nPrefix}.roster.change`, { ns: 'workflow' })}
        </button>
      </div>
      <button
        type="button"
        aria-label={t(`${i18nPrefix}.roster.openPanel`, { ns: 'workflow', name: agent.name })}
        className="flex h-13 w-full min-w-0 cursor-pointer items-center gap-2 rounded-[10px] border-[0.5px] border-components-panel-border bg-components-panel-on-panel-item-bg py-2 pr-4 pl-2 text-left shadow-xs shadow-shadow-shadow-3 hover:bg-components-panel-on-panel-item-bg-hover focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden"
        onClick={() => setIsPanelOpen(true)}
      >
        <AgentRosterAvatar agent={agent} />
        <span className="flex min-w-0 flex-1 flex-col gap-0.5 py-px">
          <span className="truncate system-sm-medium text-text-secondary">
            {agent.name}
          </span>
          <span className="truncate system-xs-regular text-text-tertiary">
            {agent.description}
          </span>
        </span>
        <span className="flex shrink-0 items-center text-text-tertiary">
          <span aria-hidden className="i-ri-arrow-right-line size-4" />
        </span>
      </button>
      {isPanelOpen && (
        <AgentRosterLayeredPanel
          agent={agent}
          onClose={() => setIsPanelOpen(false)}
        />
      )}
    </FieldRoot>
  )
}

export function AgentPanel({
  data,
}: NodePanelProps<AgentNodeType>) {
  const { t } = useTranslation()

  return (
    <div className="my-2">
      <AgentRosterField agent={data.agent_roster} />
      <div>
        <OutputVars>
          <VarItem
            name="text"
            type="String"
            description={t(`${i18nPrefix}.outputVars.text`, { ns: 'workflow' })}
          />
          <VarItem
            name="usage"
            type="object"
            description={t(`${i18nPrefix}.outputVars.usage`, { ns: 'workflow' })}
          />
          <VarItem
            name="files"
            type="Array[File]"
            description={t(`${i18nPrefix}.outputVars.files.title`, { ns: 'workflow' })}
          />
          <VarItem
            name="json"
            type="Array[Object]"
            description={t(`${i18nPrefix}.outputVars.json`, { ns: 'workflow' })}
          />
        </OutputVars>
      </div>
    </div>
  )
}
