import type { ExternalAgentOverview } from '../model'
import type { ExternalAgentWorkflowBinding, ExternalAgentWorkflowPreviewAgent } from './types'
import type { AgentRosterNodeData } from '@/app/components/workflow/block-selector/types'
import { Button } from '@langgenius/dify-ui/button'
import { Dialog, DialogTrigger } from '@langgenius/dify-ui/dialog'
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from '@langgenius/dify-ui/popover'
import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import AppIcon from '@/app/components/base/app-icon'
import { WorkflowAgentSelectorContent } from '@/app/components/workflow/block-selector/workflow-agent-selector'
import { ExternalAgentDetailsDialogContent } from './details-dialog'
import { ExternalAgentBadge } from './external-badge'

export function ExternalAgentField({
  binding,
  overview,
  isChanging,
  hasError,
  readOnly,
  onChange,
  onSelectDify,
  onStartFromScratch,
}: {
  binding?: ExternalAgentWorkflowBinding
  overview?: ExternalAgentOverview
  isChanging: boolean
  hasError: boolean
  readOnly: boolean
  onChange: (agent: ExternalAgentWorkflowPreviewAgent) => Promise<boolean>
  onSelectDify: (agent: AgentRosterNodeData) => void
  onStartFromScratch: () => void
}) {
  const { t } = useTranslation(['workflow', 'workflowAgent', 'agentRoster'])
  const labelId = useId()
  const [open, setOpen] = useState(false)
  const originalName = binding?.original_reference?.display_name
  const name =
    overview?.agent.name ??
    (typeof originalName === 'string'
      ? originalName
      : t(($) => $['external.workflow.unconnected'], { ns: 'agentRoster' }))
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <div role="group" aria-labelledby={labelId} className="px-4 pt-4 pb-2">
        <div className="mb-1 flex h-6 items-center justify-between gap-2">
          <span id={labelId} className="system-sm-semibold-uppercase text-text-secondary">
            {t(($) => $['nodes.agent.roster.label'], { ns: 'workflow' })}
          </span>
          <PopoverTrigger
            render={
              <Button
                variant="ghost"
                size="small"
                disabled={isChanging || readOnly}
                className="text-text-tertiary"
              />
            }
          >
            {t(($) => $['nodes.agent.roster.change'], { ns: 'workflowAgent' })}
          </PopoverTrigger>
        </div>
        <Dialog>
          <DialogTrigger
            disabled={!binding?.agent_id}
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
                icon={overview?.agent.icon}
                fallback={{
                  content: (
                    <span aria-hidden className="i-ri-robot-2-line size-3.5 text-text-accent" />
                  ),
                  background: 'var(--color-background-default)',
                }}
              />
            </span>
            {/* oxlint-disable-next-line dify/require-title-for-truncated-text -- This trigger opens the agent details dialog with its full identity. */}
            <span className="truncate system-sm-regular text-components-input-text-filled">
              {name}
            </span>
            <ExternalAgentBadge />
            <span
              aria-hidden
              className="ms-auto me-1 i-ri-arrow-right-s-line size-4 shrink-0 text-text-tertiary"
            />
          </DialogTrigger>
          {binding?.agent_id && <ExternalAgentDetailsDialogContent agentId={binding.agent_id} />}
        </Dialog>
        {hasError && (
          <p role="alert" className="mt-1 system-xs-regular text-text-destructive">
            {t(($) => $['external.workflow.rebindError'], { ns: 'agentRoster' })}
          </p>
        )}
      </div>
      <PopoverContent align="start" className="w-92 max-w-[calc(100vw-2rem)] overflow-hidden">
        <PopoverTitle className="sr-only">
          {t(($) => $['roster.nodeSelector.dialogLabel'], { ns: 'agentRoster' })}
        </PopoverTitle>
        <WorkflowAgentSelectorContent
          onSelect={onSelectDify}
          onSelectExternal={onChange}
          onStartFromScratch={onStartFromScratch}
          onRequestClose={() => setOpen(false)}
        />
      </PopoverContent>
    </Popover>
  )
}
