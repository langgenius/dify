'use client'

import type { ReactNode } from 'react'
import { cn } from '@langgenius/dify-ui/cn'
import {
  CollapsiblePanel,
  CollapsibleRoot,
  CollapsibleTrigger,
} from '@langgenius/dify-ui/collapsible'
import { Infotip } from '@/app/components/base/infotip'

type ConfigureSectionBaseProps = {
  label: ReactNode
  labelId: string
  children: ReactNode
  actions?: ReactNode
  description?: ReactNode
  headingLevel?: 'h3' | 'h4'
  panelId?: string
  rootClassName?: string
  headerClassName?: string
  titleRowClassName?: string
  panelContentClassName?: string
}

type ConfigureSectionProps = ConfigureSectionBaseProps & (
  | {
    tip: ReactNode
    tipAriaLabel: string
  }
  | {
    tip?: undefined
    tipAriaLabel?: undefined
  }
)

export function ConfigureSection({
  label,
  labelId,
  children,
  actions,
  description,
  headingLevel = 'h3',
  panelId,
  tip,
  tipAriaLabel,
  rootClassName,
  headerClassName,
  titleRowClassName,
  panelContentClassName,
}: ConfigureSectionProps) {
  const Heading = headingLevel

  return (
    <CollapsibleRoot
      render={<section />}
      defaultOpen
      className={rootClassName}
      aria-labelledby={labelId}
    >
      <div className={cn('mb-2 flex min-h-6 items-center gap-2', headerClassName)}>
        <div className="min-w-0 flex-1">
          <div className={cn('flex min-w-0 items-center gap-0.5', titleRowClassName)}>
            <Heading id={labelId} className="min-w-0">
              <CollapsibleTrigger
                className="group h-6 min-h-0 justify-start gap-0 rounded-sm px-0 text-text-secondary hover:not-data-disabled:bg-transparent hover:not-data-disabled:text-text-secondary data-panel-open:text-text-secondary"
              >
                <span className="min-w-0 truncate system-sm-semibold-uppercase">
                  {label}
                </span>
                <span
                  aria-hidden
                  className="i-custom-vender-solid-arrows-arrow-down-round-fill size-4 shrink-0 -rotate-90 text-text-quaternary transition-transform group-data-panel-open:rotate-0 motion-reduce:transition-none"
                />
              </CollapsibleTrigger>
            </Heading>
            {tip && (
              <Infotip aria-label={tipAriaLabel} popupClassName="max-w-64">
                {tip}
              </Infotip>
            )}
          </div>
          {description && (
            <p className="system-xs-regular text-text-tertiary">
              {description}
            </p>
          )}
        </div>
        {actions}
      </div>
      <CollapsiblePanel id={panelId}>
        <div className={panelContentClassName}>
          {children}
        </div>
      </CollapsiblePanel>
    </CollapsibleRoot>
  )
}
