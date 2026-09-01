'use client'

import type { ReactNode } from 'react'
import type { AccessPointStatus } from './status'
import { cn } from '@langgenius/dify-ui/cn'
import { StatusDot, StatusDotSkeleton } from '@langgenius/dify-ui/status-dot'
import { Switch } from '@langgenius/dify-ui/switch'
import { Tooltip, TooltipContent, TooltipTrigger } from '@langgenius/dify-ui/tooltip'
import { useId } from 'react'

type AccessPointCardProps = {
  actions?: ReactNode
  children: ReactNode
  description: string
  icon: ReactNode | string
  status: AccessPointStatus
  statusLabel: string
  title: string
  busy?: boolean
  className?: string
  headingLevel?: 2 | 3
  highlighted?: boolean
  onEnabledChange?: (enabled: boolean) => void
  showStatus?: boolean
  switchDisabled?: boolean
  switchDisabledReason?: string
  switchLabel?: string
}

export function AccessPointCard({
  actions,
  busy = false,
  children,
  className,
  description,
  headingLevel = 2,
  highlighted = false,
  icon,
  onEnabledChange,
  showStatus = true,
  status,
  statusLabel,
  switchDisabled = false,
  switchDisabledReason,
  switchLabel,
  title,
}: AccessPointCardProps) {
  const titleId = useId()
  const isEnabled = status === 'inService'
  const isLoading = status === 'loading'
  const showSwitch = (status === 'disabled' || status === 'inService') && Boolean(onEnabledChange)
  const hasSwitchDisabledReason = switchDisabled && Boolean(switchDisabledReason)
  const Heading = headingLevel === 3 ? 'h3' : 'h2'
  const switchControl = (
    <Switch
      checked={isEnabled}
      disabled={switchDisabled && !hasSwitchDisabledReason}
      loading={busy}
      {...(hasSwitchDisabledReason
        ? { readOnly: true, 'aria-disabled': true, 'data-disabled': '' }
        : {})}
      aria-label={switchLabel || title}
      onCheckedChange={(enabled) => {
        if (!switchDisabled) onEnabledChange?.(enabled)
      }}
    />
  )

  return (
    <section
      aria-labelledby={titleId}
      aria-busy={isLoading || undefined}
      data-highlighted={highlighted || undefined}
      className={cn(
        'flex min-h-68 min-w-0 flex-col gap-0.5 rounded-xl bg-background-section-burn p-1',
        highlighted && 'ring-2 ring-state-accent-solid',
        className,
      )}
    >
      <header className="flex min-h-14 shrink-0 items-center gap-2.5 py-2 pr-5 pl-2">
        {typeof icon === 'string' ? (
          <span className="flex size-10 shrink-0 items-center justify-center rounded-[10px] border-[0.5px] border-divider-regular bg-components-panel-on-panel-item-bg text-text-secondary">
            <span aria-hidden className={cn(icon, 'size-5')} />
          </span>
        ) : (
          icon
        )}
        <span className="min-w-0 flex-1">
          <Heading
            id={titleId}
            className="truncate system-md-semibold text-text-primary"
            title={title}
          >
            {title}
          </Heading>
          <span className="block truncate system-xs-regular text-text-tertiary" title={description}>
            {description}
          </span>
        </span>
        {showStatus && (
          <>
            <span
              aria-live="polite"
              className={cn(
                'flex shrink-0 items-center gap-1 system-xs-semibold-uppercase',
                status === 'inService' ? 'text-text-success' : 'text-text-tertiary',
              )}
            >
              {isLoading ? (
                <StatusDotSkeleton className="animate-pulse motion-reduce:animate-none" />
              ) : (
                <StatusDot status={status === 'inService' ? 'success' : 'disabled'} />
              )}
              {statusLabel}
            </span>
            {showSwitch &&
              (hasSwitchDisabledReason ? (
                <Tooltip>
                  <TooltipTrigger render={switchControl} />
                  <TooltipContent role="tooltip">{switchDisabledReason}</TooltipContent>
                </Tooltip>
              ) : (
                switchControl
              ))}
          </>
        )}
      </header>

      <div className="flex min-h-0 flex-1 flex-col rounded-[10px] bg-components-panel-on-panel-item-bg">
        <div className="min-h-0 flex-1">{children}</div>
        {actions !== undefined && (
          <footer className="flex shrink-0 flex-wrap items-center gap-2 border-t-[0.5px] border-divider-subtle p-4">
            {actions}
          </footer>
        )}
      </div>
    </section>
  )
}

type AccessPointEndpointProps = {
  actions?: ReactNode
  label: string
  unavailableLabel: string
  value: string
  dimmed?: boolean
  loading?: boolean
  unavailable?: boolean
}

export function AccessPointEndpoint({
  actions,
  dimmed = false,
  label,
  loading = false,
  unavailable = false,
  unavailableLabel,
  value,
}: AccessPointEndpointProps) {
  return (
    <div aria-busy={loading || undefined} className="flex flex-col gap-1 px-4 py-3">
      <div className="flex h-6 items-center system-xs-medium text-text-secondary">{label}</div>
      <div className="flex h-9 min-w-0 items-center gap-0.5 rounded-lg border-[0.5px] border-divider-subtle bg-components-input-bg-normal py-1 pr-1 pl-2">
        {unavailable && !loading && (
          <span className="shrink-0 rounded-[5px] border border-divider-deep px-1 py-0.5 system-2xs-medium-uppercase text-text-tertiary">
            {unavailableLabel}
          </span>
        )}
        <div className="flex min-w-0 flex-1 items-center px-1">
          {loading ? (
            <span className="h-2 w-[42%] animate-pulse rounded-full bg-text-quaternary opacity-20 motion-reduce:animate-none" />
          ) : (
            <span
              className={cn(
                'truncate system-sm-regular text-text-secondary',
                (dimmed || unavailable) && 'text-text-quaternary',
              )}
              translate="no"
            >
              {value}
            </span>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-0.5">{actions}</div>
      </div>
    </div>
  )
}

export function AccessPointEmptyContent({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-full min-h-36 items-center justify-center px-6 py-8 text-center system-xs-regular whitespace-pre-line text-text-tertiary">
      {children}
    </div>
  )
}
