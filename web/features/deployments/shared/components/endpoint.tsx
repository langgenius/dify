'use client'

import type { ReactNode } from 'react'
import { cn } from '@langgenius/dify-ui/cn'
import { toast } from '@langgenius/dify-ui/toast'
import { useClipboard } from 'foxact/use-clipboard'
import { useTranslation } from '#i18n'

type CopyPillProps = {
  label: string
  value: string
  prefix?: ReactNode
  className?: string
}

export function CopyPill({ label, value, prefix, className }: CopyPillProps) {
  const { t } = useTranslation('deployments')
  const { copied, copy } = useClipboard({
    onCopyError: () => {
      toast.error(t('access.copyFailed'))
    },
  })

  return (
    <div
      className={cn(
        'flex h-8 items-center gap-1 rounded-lg border border-components-input-border-active bg-components-input-bg-normal pr-1 pl-1.5',
        className,
      )}
    >
      <div className="flex h-5 shrink-0 items-center rounded-md border border-divider-subtle px-1.5 system-2xs-medium text-text-tertiary">
        {label}
      </div>
      {prefix}
      <div className="min-w-0 flex-1 truncate px-1 font-mono system-sm-medium text-text-secondary">
        {value}
      </div>
      <div className="h-3.5 w-px shrink-0 bg-divider-regular" />
      <button
        type="button"
        onClick={() => copy(value)}
        aria-label={t('access.copy')}
        className="flex size-6 shrink-0 items-center justify-center rounded-md text-text-tertiary hover:bg-state-base-hover hover:text-text-secondary"
      >
        <span className={cn(copied ? 'i-ri-check-line' : 'i-ri-file-copy-line', 'size-3.5')} />
      </button>
    </div>
  )
}

type EndpointRowProps = {
  envName: string
  label: string
  value: string
  openLabel?: string
}

export function EndpointRow({ envName, label, value, openLabel }: EndpointRowProps) {
  return (
    <div className="grid items-center gap-x-3 gap-y-1.5 sm:grid-cols-[minmax(88px,108px)_minmax(0,1fr)_auto]">
      <span className="min-w-0 truncate system-xs-regular text-text-tertiary">
        {envName}
      </span>
      <CopyPill label={label} value={value} className="min-w-0" />
      {openLabel && (
        <a
          href={value}
          target="_blank"
          rel="noreferrer"
          className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-components-button-secondary-border bg-components-button-secondary-bg px-3 system-sm-medium text-components-button-secondary-text hover:bg-components-button-secondary-bg-hover"
        >
          <span className="i-ri-external-link-line size-3.5" />
          {openLabel}
        </a>
      )}
    </div>
  )
}
