'use client'

import type { ContactImProviderDefinition } from './types'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { ContactImProvider } from './types'

const providerIconClassNames = {
  [ContactImProvider.DingTalk]: 'i-ri-message-3-line text-util-colors-blue-blue-600',
  [ContactImProvider.Email]: 'i-ri-mail-send-fill text-text-accent',
  [ContactImProvider.Feishu]: 'i-ri-flight-takeoff-line text-util-colors-cyan-cyan-600',
  [ContactImProvider.Slack]: 'i-ri-slack-line text-util-colors-purple-purple-600',
} satisfies Record<ContactImProviderDefinition['provider'], string>

export type ContactImProviderCardProps = {
  actionAriaLabel: string
  actionDisabled: boolean
  actionLabel: string
  description: string
  provider: ContactImProviderDefinition
  showAddIcon?: boolean
  unavailableReason?: string
  onAction: () => void
}

export function ContactImProviderCard({
  actionAriaLabel,
  actionDisabled,
  actionLabel,
  description,
  provider,
  showAddIcon = false,
  unavailableReason,
  onAction,
}: ContactImProviderCardProps) {
  return (
    <div
      role="group"
      aria-label={provider.displayName}
      className="flex min-h-16 items-center gap-3 rounded-[15px] border-[0.5px] border-components-panel-border bg-components-panel-on-panel-item-bg-hover px-3 py-2"
    >
      <div className="flex size-10 shrink-0 items-center justify-center rounded-[10px] border border-divider-regular bg-components-panel-on-panel-item-bg shadow-xs">
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
        variant={showAddIcon ? 'secondary-accent' : 'secondary'}
        onClick={onAction}
      >
        {showAddIcon && <span aria-hidden="true" className="i-ri-add-line size-4" />}
        {actionLabel}
      </Button>
    </div>
  )
}
