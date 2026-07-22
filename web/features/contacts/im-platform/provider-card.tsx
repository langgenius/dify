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

type ContactImProviderCardBaseProps = {
  description: string
  provider: ContactImProviderDefinition
  unavailableReason?: string
}

type ContactImAvailableProviderCardProps = ContactImProviderCardBaseProps & {
  actionAriaLabel: string
  actionDisabled: boolean
  actionLabel: string
  mode: 'available'
  showAddIcon?: boolean
  onAction: () => void
}

type ContactImConfiguredProviderCardProps = ContactImProviderCardBaseProps & {
  actionDisabled: boolean
  configureAriaLabel: string
  deleteAriaLabel: string
  mode: 'configured'
  onConfigure: () => void
  onDelete: () => void
}

export type ContactImProviderCardProps =
  | ContactImAvailableProviderCardProps
  | ContactImConfiguredProviderCardProps

export function ContactImProviderCard(props: ContactImProviderCardProps) {
  const { description, provider, unavailableReason } = props

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
      {props.mode === 'configured' ? (
        <div className="flex shrink-0 items-center gap-1 border-l border-divider-subtle pl-2">
          <Button
            aria-label={props.configureAriaLabel}
            className="size-8 px-0"
            disabled={props.actionDisabled}
            variant="tertiary"
            onClick={props.onConfigure}
          >
            <span aria-hidden="true" className="i-ri-equalizer-2-line size-4 text-text-tertiary" />
          </Button>
          <Button
            aria-label={props.deleteAriaLabel}
            className="group size-8 px-0"
            disabled={props.actionDisabled}
            variant="tertiary"
            onClick={props.onDelete}
          >
            <span
              aria-hidden="true"
              className="i-ri-delete-bin-line size-4 text-text-tertiary group-hover:text-text-destructive"
            />
          </Button>
        </div>
      ) : (
        <Button
          aria-label={props.actionAriaLabel}
          className="shrink-0"
          disabled={props.actionDisabled}
          variant={props.showAddIcon ? 'secondary-accent' : 'secondary'}
          onClick={props.onAction}
        >
          {props.showAddIcon && <span aria-hidden="true" className="i-ri-add-line size-4" />}
          {props.actionLabel}
        </Button>
      )}
    </div>
  )
}
