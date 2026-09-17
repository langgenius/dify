'use client'

import type { ContactImProviderDefinition } from './types'
import { Button } from '@langgenius/dify-ui/button'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import { ContactChannelIcon } from '../management/channel-icon'
import { ContactImProvider } from './types'

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
      className="flex min-h-16 w-full items-center gap-3 rounded-[15px] bg-third-party-model-bg-default py-3 pr-4 pl-3 inset-ring-[0.5px] inset-ring-components-panel-border"
    >
      <div className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-[10px] border border-divider-regular bg-components-panel-on-panel-item-bg backdrop-blur-[4px]">
        {provider.provider === ContactImProvider.Email ? (
          <span aria-hidden className="i-ri-mail-send-fill size-6 text-text-accent" />
        ) : (
          <ContactChannelIcon provider={provider.provider} className="size-8" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="system-md-semibold text-text-primary">{provider.displayName}</div>
        <div className="system-xs-regular text-text-tertiary">
          {unavailableReason ?? description}
        </div>
      </div>
      {props.mode === 'configured' ? (
        <div className="flex shrink-0 items-center gap-2">
          <span aria-hidden="true" className="ml-1 h-3 w-px bg-divider-regular" />
          <div className="flex items-center gap-1">
            <IconButton
              aria-label={props.configureAriaLabel}
              disabled={props.actionDisabled}
              size="lg"
              onClick={props.onConfigure}
            >
              <span aria-hidden="true" className="i-ri-equalizer-2-line size-4" />
            </IconButton>
            <IconButton
              aria-label={props.deleteAriaLabel}
              disabled={props.actionDisabled}
              size="md"
              tone="destructive"
              onClick={props.onDelete}
            >
              <span aria-hidden="true" className="i-ri-delete-bin-line size-4" />
            </IconButton>
          </div>
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
