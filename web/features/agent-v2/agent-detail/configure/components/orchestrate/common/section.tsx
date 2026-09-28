'use client'

import type { ReactNode } from 'react'
import type { AgentBuildDraftChangeSection } from '../build-draft-changes-context'
import { cn } from '@langgenius/dify-ui/cn'
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from '@langgenius/dify-ui/collapsible'
import { Infotip, InfotipContent, InfotipTrigger } from '@langgenius/dify-ui/infotip'
import { AgentBuildDraftChangeDot } from '../build-draft-change-dot'
import { useIsAgentBuildDraftSectionChanged } from '../build-draft-changes-context'

type ConfigureSectionProps = {
  tip?: ReactNode
  label: ReactNode
  labelId: string
  children: ReactNode
  actions?: ReactNode
  buildDraftChangeSection?: AgentBuildDraftChangeSection
  description?: ReactNode
  defaultOpen?: boolean
  headingLevel?: 'h3' | 'h4'
  panelId?: string
  rootClassName?: string
  headerClassName?: string
  titleRowClassName?: string
  panelContentClassName?: string
}

export function ConfigureSection({
  label,
  labelId,
  children,
  actions,
  buildDraftChangeSection,
  description,
  defaultOpen = true,
  headingLevel = 'h3',
  panelId,
  tip,
  rootClassName,
  headerClassName,
  titleRowClassName,
  panelContentClassName,
}: ConfigureSectionProps) {
  const Heading = headingLevel
  const hasDescription = description !== undefined && description !== null
  const hasTip = tip !== undefined && tip !== null
  const isBuildDraftChanged = useIsAgentBuildDraftSectionChanged(buildDraftChangeSection)

  return (
    <Collapsible
      render={<section />}
      defaultOpen={defaultOpen}
      className={rootClassName}
      aria-labelledby={labelId}
    >
      <div className={cn('mb-2 flex min-h-6 items-center gap-2', headerClassName)}>
        <div className="min-w-0 flex-1">
          <div className={cn('group/collapse-title flex min-w-0 items-center', titleRowClassName)}>
            <Heading className="relative min-w-0 shrink-0">
              {isBuildDraftChanged && <AgentBuildDraftChangeDot />}
              <CollapsibleTrigger className="flex h-6 min-h-0 max-w-full touch-manipulation items-center justify-start gap-0 rounded-sm system-sm-medium text-text-secondary outline-hidden select-none focus-visible:ring-2 focus-visible:ring-state-accent-solid">
                <span id={labelId} className="min-w-0 truncate system-sm-semibold-uppercase">
                  {label}
                </span>
              </CollapsibleTrigger>
            </Heading>
            {hasTip && (
              <Infotip>
                <InfotipTrigger aria-labelledby={labelId} className="ml-0.5 size-3.5" />
                <InfotipContent aria-labelledby={labelId} className="max-w-64">
                  {tip}
                </InfotipContent>
              </Infotip>
            )}
            <span
              aria-hidden="true"
              className="i-custom-vender-solid-general-arrow-down-round-fill size-3.5 shrink-0 rotate-270 text-text-quaternary transition-transform group-has-data-panel-open/collapse-title:rotate-0 motion-reduce:transition-none"
            />
          </div>
          {hasDescription && <p className="system-xs-regular text-text-tertiary">{description}</p>}
        </div>
        {actions}
      </div>
      <CollapsiblePanel id={panelId}>
        <div className={panelContentClassName}>{children}</div>
      </CollapsiblePanel>
    </Collapsible>
  )
}
