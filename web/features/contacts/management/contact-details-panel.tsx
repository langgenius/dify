'use client'

import type { ContactView } from './types'
import { Avatar } from '@langgenius/dify-ui/avatar'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@langgenius/dify-ui/dropdown-menu'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import { useTranslation } from 'react-i18next'
import { ContactChannelIcon } from './channel-icon'
import { getContactChannelLabel } from './channel-utils'
import { formatContactRelativeTime } from './relative-time'

export function ContactDetailsPanel({
  contact,
  onEdit,
  onClose,
  onRemove,
}: {
  contact: ContactView
  onEdit: () => void
  onClose: () => void
  onRemove: () => void
}) {
  const { i18n, t } = useTranslation('contacts')
  const channels = [
    { id: 'email', provider: 'email' },
    ...contact.im_bindings.filter(
      (binding, index, bindings) =>
        bindings.findIndex((candidate) => candidate.provider === binding.provider) === index,
    ),
  ]

  return (
    <aside
      aria-label={t(($) => $['details.title'])}
      className="relative z-20 flex h-full w-80 max-w-full shrink-0 flex-col overflow-hidden rounded-xl border border-divider-subtle bg-components-panel-bg shadow-xl"
    >
      <div className="absolute top-3 right-3 z-10 flex items-center gap-1">
        {contact.type !== 'workspace' && (
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <IconButton aria-label={t(($) => $['details.more'])} size="sm">
                  <span aria-hidden className="i-ri-more-fill size-4" />
                </IconButton>
              }
            />
            <DropdownMenuContent className="min-w-32">
              {contact.type === 'external' && (
                <DropdownMenuItem className="gap-2" onClick={onEdit}>
                  <span aria-hidden className="i-ri-edit-line size-4 text-text-tertiary" />
                  {t(($) => $['details.edit'])}
                </DropdownMenuItem>
              )}
              <DropdownMenuItem variant="destructive" className="gap-2" onClick={onRemove}>
                <span aria-hidden className="i-ri-delete-bin-line size-4" />
                {t(($) => $['details.remove'])}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        <IconButton aria-label={t(($) => $['action.close'])} size="sm" onClick={onClose}>
          <span aria-hidden className="i-ri-close-line size-4" />
        </IconButton>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="relative px-4 pt-10 pb-4 text-center">
          <div className="absolute inset-x-1 top-1 h-25 overflow-hidden rounded-lg bg-linear-to-b from-primary-50 to-components-panel-bg">
            <span className="absolute top-1/2 left-1/2 size-31 -translate-x-1/2 -translate-y-1/2 rounded-full border border-divider-subtle" />
            <span className="absolute top-1/2 left-1/2 size-39 -translate-x-1/2 -translate-y-1/2 rounded-full border border-divider-subtle opacity-60" />
          </div>
          <Avatar
            avatar={contact.avatar_url || null}
            className="relative mx-auto size-24 ring-4 ring-components-panel-bg"
            name={contact.name}
            size="3xl"
          />
          <h2 className="relative mt-2 title-xl-semi-bold text-text-primary">{contact.name}</h2>
          {contact.email && (
            <p className="relative mt-0.5 system-xs-regular text-text-tertiary">{contact.email}</p>
          )}
          <span className="relative mt-2 inline-flex rounded-md border border-divider-subtle px-1 py-0.5 system-xs-regular text-text-tertiary uppercase">
            {t(($) => $[`type.${contact.type}`])}
          </span>
        </div>
        <div className="mt-1 border-t border-divider-subtle px-4 pt-7">
          <div className="mb-2 flex items-center justify-between">
            <div className="flex items-center gap-1">
              <h3 className="system-sm-semibold-uppercase text-text-secondary">
                {t(($) => $['details.channels'])}
              </h3>
              <span aria-hidden className="i-ri-question-line size-3.5 text-text-quaternary" />
            </div>
            <span aria-hidden className="i-ri-add-line size-4 text-text-tertiary" />
          </div>
          <div className="space-y-1">
            {channels.map((channel) => {
              const label = getContactChannelLabel(channel.provider)
              const configurable = channel.provider.toLocaleLowerCase() !== 'email'
              return (
                <div
                  key={channel.id}
                  className="flex h-8 items-center gap-1 rounded-lg border border-divider-subtle bg-components-panel-on-panel-item-bg px-1 shadow-xs"
                >
                  <div className="flex min-w-0 flex-1 items-center gap-1.5 px-0.5">
                    <ContactChannelIcon provider={channel.provider} />
                    <span className="truncate system-sm-medium text-text-secondary" title={label}>
                      {label}
                    </span>
                  </div>
                  {configurable && (
                    <div className="flex items-center text-text-tertiary">
                      <span aria-hidden className="i-ri-equalizer-2-line size-4 p-1" />
                      <span aria-hidden className="i-ri-delete-bin-line size-4 p-1" />
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      </div>
      <p className="shrink-0 px-4 py-4 system-xs-regular text-text-tertiary">
        {t(($) => $['details.joined'])}{' '}
        {formatContactRelativeTime(contact.created_at, i18n.resolvedLanguage ?? 'en')}
      </p>
    </aside>
  )
}
