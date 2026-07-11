'use client'

import type { ReactNode } from 'react'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { StatusDot } from '@langgenius/dify-ui/status-dot'
import { Switch } from '@langgenius/dify-ui/switch'
import { toast } from '@langgenius/dify-ui/toast'
import { useClipboard } from 'foxact/use-clipboard'
import { useId } from 'react'
import { useTranslation } from 'react-i18next'

export type AccessSurfaceCardProps = {
  title: string
  icon: string
  iconClassName: string
  endpointLabel: string
  endpoint: string
  enabled: boolean
  onEnabledChange: (enabled: boolean) => void
  copyLabel: string
  children: ReactNode
  badge?: ReactNode
  endpointActions?: ReactNode
  disabled?: boolean
  busy?: boolean
}

export const accessSurfaceActionClassName = 'inline-flex h-8 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg border-[0.5px] border-components-button-secondary-border bg-components-button-secondary-bg px-3 text-[13px] leading-4 font-medium text-components-button-secondary-text shadow-xs outline-hidden backdrop-blur-[5px] hover:border-components-button-secondary-border-hover hover:bg-components-button-secondary-bg-hover focus-visible:ring-2 focus-visible:ring-state-accent-solid'

export function AccessSurfaceCard({
  title,
  icon,
  iconClassName,
  endpointLabel,
  endpoint,
  enabled,
  onEnabledChange,
  copyLabel,
  children,
  badge,
  endpointActions,
  disabled = false,
  busy = false,
}: AccessSurfaceCardProps) {
  const { t } = useTranslation('agentV2')
  const { t: tCommon } = useTranslation('common')
  const titleId = useId()
  const { copied, copy } = useClipboard({
    timeout: 2000,
    onCopyError: () => {
      toast.error(t($ => $['agentDetail.access.copyFailed']))
    },
  })
  const canCopyEndpoint = Boolean(endpoint)
  const switchDisabled = disabled || busy

  const handleCopyEndpoint = () => {
    if (!canCopyEndpoint)
      return

    void copy(endpoint)
  }

  return (
    <article aria-labelledby={titleId} className="rounded-xl border border-components-panel-border bg-components-panel-bg shadow-xs">
      <div className="px-4 pt-4 pb-4">
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
          <div className="flex min-w-48 flex-1 items-center gap-2">
            <span className={cn('flex size-6 shrink-0 items-center justify-center rounded-lg', iconClassName)}>
              <span aria-hidden className={cn(icon, 'size-4')} />
            </span>
            <h3 id={titleId} className="truncate system-md-semibold text-text-secondary">
              {title}
            </h3>
            {badge}
          </div>

          <div className="flex shrink-0 items-center gap-3">
            <span className={cn(
              'inline-flex items-center gap-1 system-xs-semibold-uppercase',
              enabled ? 'text-util-colors-green-green-700' : 'text-text-tertiary',
            )}
            >
              <StatusDot status={enabled ? 'success' : 'disabled'} size="small" />
              {t($ => $[enabled ? 'agentDetail.access.status.inService' : 'agentDetail.access.status.outOfService'])}
            </span>
            <Switch
              size="md"
              checked={enabled}
              disabled={switchDisabled}
              aria-label={t($ => $['agentDetail.access.toggleSurface'], { name: title })}
              onCheckedChange={onEnabledChange}
            />
          </div>
        </div>

        <div className="mt-3">
          <div className="system-xs-medium text-text-tertiary">
            {endpointLabel}
          </div>
          <div className="mt-1 flex h-8 min-w-0 items-center rounded-lg bg-components-input-bg-normal px-2">
            <span className="min-w-0 flex-1 truncate system-sm-regular text-text-secondary" translate="no">
              {endpoint || t($ => $['agentDetail.access.workflow.notAvailable'])}
            </span>
            <Button
              variant="ghost"
              size="small"
              className="size-6 shrink-0 px-0 text-text-tertiary hover:text-text-secondary"
              aria-label={copied ? tCommon($ => $['operation.copied']) : copyLabel}
              disabled={!canCopyEndpoint}
              onClick={handleCopyEndpoint}
            >
              <span aria-hidden className={cn(copied ? 'i-ri-check-line' : 'i-ri-file-copy-line', 'size-4')} />
            </Button>
            {endpointActions}
          </div>
        </div>
      </div>

      <div className="flex min-h-16 flex-wrap items-center gap-2 border-t border-divider-subtle px-4 py-4">
        {children}
      </div>
    </article>
  )
}
