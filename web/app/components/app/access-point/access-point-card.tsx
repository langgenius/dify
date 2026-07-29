'use client'

import type { ReactNode } from 'react'
import { cn } from '@langgenius/dify-ui/cn'
import { StatusDot } from '@langgenius/dify-ui/status-dot'
import { Switch } from '@langgenius/dify-ui/switch'
import { useId } from 'react'

export type AccessPointStatus = 'disabled' | 'inService' | 'unavailable'

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
  onEnabledChange?: (enabled: boolean) => void
  showStatus?: boolean
  switchDisabled?: boolean
  switchLabel?: string
}

export function AccessPointCard({
  actions,
  busy = false,
  children,
  className,
  description,
  icon,
  onEnabledChange,
  showStatus = true,
  status,
  statusLabel,
  switchDisabled = false,
  switchLabel,
  title,
}: AccessPointCardProps) {
  const titleId = useId()
  const isEnabled = status === 'inService'
  const showSwitch = status !== 'unavailable' && Boolean(onEnabledChange)

  return (
    <article
      aria-labelledby={titleId}
      className={cn(
        'flex min-h-68 min-w-0 flex-col gap-0.5 rounded-xl bg-background-section-burn p-1',
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
          <h2 id={titleId} className="truncate system-md-semibold text-text-primary">
            {title}
          </h2>
          <span className="block truncate system-xs-regular text-text-tertiary">{description}</span>
        </span>
        {showStatus && (
          <>
            <span
              className={cn(
                'flex shrink-0 items-center gap-1 system-xs-semibold-uppercase',
                status === 'inService' ? 'text-text-success' : 'text-text-tertiary',
              )}
            >
              <StatusDot status={status === 'inService' ? 'success' : 'disabled'} />
              {statusLabel}
            </span>
            {showSwitch && (
              <Switch
                checked={isEnabled}
                disabled={switchDisabled}
                loading={busy}
                aria-label={switchLabel || title}
                onCheckedChange={onEnabledChange}
              />
            )}
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
    </article>
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
    <div className="flex flex-col gap-1 px-4 py-3">
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
