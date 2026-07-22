'use client'

import type { ContactView } from './types'
import { Avatar } from '@langgenius/dify-ui/avatar'
import { Button } from '@langgenius/dify-ui/button'
import { useTranslation } from 'react-i18next'

export function ContactDetailsPanel({
  contact,
  onClose,
}: {
  contact: ContactView
  onClose: () => void
}) {
  const { t } = useTranslation('contacts')

  return (
    <aside
      aria-label={t(($) => $['details.title'])}
      className="absolute inset-y-0 right-0 z-20 flex w-80 max-w-full flex-col border-l border-divider-subtle bg-components-panel-bg shadow-xl"
    >
      <div className="flex h-12 shrink-0 items-center justify-end px-4">
        <Button
          variant="ghost"
          aria-label={t(($) => $['action.close'])}
          className="px-2"
          onClick={onClose}
        >
          <span aria-hidden className="i-ri-close-line size-4" />
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="bg-gradient-to-b from-primary-50 to-components-panel-bg px-5 pt-4 pb-6 text-center">
          <Avatar
            avatar={contact.avatar_url || null}
            className="mx-auto ring-4 ring-components-panel-bg"
            name={contact.name}
            size="3xl"
          />
          <h2 className="mt-3 title-xl-semi-bold text-text-primary">{contact.name}</h2>
          {contact.email && (
            <p className="mt-1 system-sm-regular text-text-tertiary">{contact.email}</p>
          )}
          <span className="mt-2 inline-flex rounded-md bg-background-default-subtle px-2 py-1 system-xs-medium text-text-secondary">
            {t(($) => $[`type.${contact.type}`])}
          </span>
        </div>
      </div>
    </aside>
  )
}
