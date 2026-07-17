'use client'

import type { ContactImProviderDefinition } from './types'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { ContactImProvider } from './types'

const providerIconClassNames = {
  [ContactImProvider.DingTalk]: 'i-ri-message-3-line text-util-colors-blue-blue-600',
  [ContactImProvider.Feishu]: 'i-ri-flight-takeoff-line text-util-colors-cyan-cyan-600',
  [ContactImProvider.Slack]: 'i-ri-slack-line text-util-colors-purple-purple-600',
} satisfies Record<ContactImProviderDefinition['provider'], string>

export type ContactImProviderCardProps = {
  actionAriaLabel: string
  actionDisabled: boolean
  actionLabel: string
  description: string
  provider: ContactImProviderDefinition
  unavailableReason?: string
  onAction: () => void
}

export function ContactImProviderCard({
  actionAriaLabel,
  actionDisabled,
  actionLabel,
  description,
  provider,
  unavailableReason,
  onAction,
}: ContactImProviderCardProps) {
  return (
    <div className="flex min-h-16 items-center gap-3 rounded-xl px-3 py-2 hover:bg-state-base-hover">
      <div className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-divider-subtle bg-background-default-subtle shadow-xs">
        <span
          aria-hidden="true"
          className={cn('size-5', providerIconClassNames[provider.provider])}
        />
      </div>
      <div className="min-w-0 flex-1">
        <div className="system-sm-semibold text-text-primary">{provider.displayName}</div>
        <div className="system-xs-regular text-text-tertiary">
          {unavailableReason ?? description}
        </div>
      </div>
      <Button
        aria-label={actionAriaLabel}
        className="shrink-0"
        disabled={actionDisabled}
        onClick={onAction}
      >
        {actionLabel}
      </Button>
    </div>
  )
}
