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
  defaultOpen?: boolean
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
  defaultOpen = true,
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
  const hasDescription = description !== undefined && description !== null
  const hasTip = tip !== undefined && tip !== null

  return (
    <CollapsibleRoot
      render={<section />}
      defaultOpen={defaultOpen}
      className={rootClassName}
      aria-labelledby={labelId}
    >
      <div className={cn('mb-2 flex min-h-6 items-center gap-2', headerClassName)}>
        <div className="min-w-0 flex-1">
          <div className={cn('flex min-w-0 items-center', titleRowClassName)}>
            <Heading id={labelId} className="min-w-0 shrink-0">
              <CollapsibleTrigger
                className="h-6 min-h-0 w-auto max-w-full justify-start gap-0 rounded-sm px-0 text-text-secondary hover:not-data-disabled:bg-transparent hover:not-data-disabled:text-text-secondary data-panel-open:text-text-secondary"
              >
                <span className="min-w-0 truncate system-sm-semibold-uppercase">
                  {label}
                </span>
              </CollapsibleTrigger>
            </Heading>
            {hasTip && (
              <Infotip aria-label={tipAriaLabel} className="ml-0.5 size-3.5" popupClassName="max-w-64">
                {tip}
              </Infotip>
            )}
            <CollapsibleTrigger
              aria-labelledby={labelId}
              className="group/collapse-icon size-3.5 min-h-0 shrink-0 justify-center rounded-sm p-0 text-text-quaternary hover:not-data-disabled:bg-transparent hover:not-data-disabled:text-text-secondary data-panel-open:text-text-quaternary"
            >
              <span
                aria-hidden="true"
                className="i-custom-vender-solid-general-arrow-down-round-fill size-3.5 rotate-270 transition-transform group-data-panel-open/collapse-icon:rotate-0 motion-reduce:transition-none"
              />
            </CollapsibleTrigger>
          </div>
          {hasDescription && (
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
