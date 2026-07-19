'use client'

import type { ContactView } from './types'
import { Avatar } from '@langgenius/dify-ui/avatar'
import { Button } from '@langgenius/dify-ui/button'
import { useTranslation } from 'react-i18next'
import { useContactDetails } from './hooks'

function TypeSpecificDetails({ contact }: { contact: ContactView }) {
  const { t } = useTranslation('contacts')

  if (contact.kind === 'workspace') {
    return (
      <>
        <DetailRow
          label={t(($) => $['details.workspaceRole'])}
          value={contact.workspaceRoleSummary}
        />
        <DetailRow label={t(($) => $['details.membership'])} value={contact.membershipStatus} />
      </>
    )
  }

  if (contact.kind === 'platform') {
    return (
      <>
        <DetailRow
          label={t(($) => $['details.organizationIdentity'])}
          value={contact.organizationIdentity}
        />
        <DetailRow
          label={t(($) => $['details.sourceWorkspace'])}
          value={contact.sourceWorkspaceSummary}
        />
      </>
    )
  }

  return (
    <>
      <DetailRow
        label={t(($) => $['details.account'])}
        value={t(($) => $['details.notDifyAccount'])}
      />
      <DetailRow
        label={t(($) => $['details.workspaceScope'])}
        value={t(($) => $['details.currentWorkspaceOnly'])}
      />
      <DetailRow label={t(($) => $['details.delivery'])} value={t(($) => $['details.emailOnly'])} />
    </>
  )
}

function DetailRow({ label, value }: { label: string; value: string | null }) {
  const { t } = useTranslation('contacts')
  return (
    <div className="flex items-start justify-between gap-3 py-2">
      <dt className="system-xs-regular text-text-tertiary">{label}</dt>
      <dd className="min-w-0 text-right system-xs-medium wrap-break-word text-text-secondary">
        {value || t(($) => $['details.missing'])}
      </dd>
    </div>
  )
}

export function ContactDetailsPanel({
  contactId,
  onClose,
}: {
  contactId: string
  onClose: () => void
}) {
  const { t } = useTranslation('contacts')
  const contactQuery = useContactDetails(contactId)
  const contact = contactQuery.data

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
      {contactQuery.isPending && (
        <div role="status" aria-label={t(($) => $['details.loading'])} className="space-y-4 px-5">
          <div className="mx-auto size-16 animate-pulse rounded-full bg-background-default-subtle" />
          <div className="mx-auto h-4 w-36 animate-pulse rounded bg-background-default-subtle" />
          <div className="h-40 animate-pulse rounded-xl bg-background-default-subtle" />
        </div>
      )}
      {contactQuery.isError && (
        <div
          role="alert"
          className="flex flex-1 flex-col items-center justify-center gap-3 px-5 text-center"
        >
          <p className="system-sm-regular text-text-secondary">{t(($) => $['details.error'])}</p>
          <Button size="small" onClick={() => contactQuery.refetch()}>
            {t(($) => $['action.retry'])}
          </Button>
        </div>
      )}
      {!contactQuery.isPending && !contactQuery.isError && !contact && (
        <div
          role="status"
          className="flex flex-1 items-center justify-center px-5 text-center system-sm-regular text-text-tertiary"
        >
          {t(($) => $['details.notFound'])}
        </div>
      )}
      {contact && (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="bg-gradient-to-b from-primary-50 to-components-panel-bg px-5 pt-4 pb-6 text-center">
            <Avatar
              avatar={contact.avatarUrl}
              className="mx-auto ring-4 ring-components-panel-bg"
              name={contact.displayName}
              size="3xl"
            />
            <h2 className="mt-3 title-xl-semi-bold text-text-primary">{contact.displayName}</h2>
            <p className="mt-1 system-sm-regular text-text-tertiary">{contact.email}</p>
            <span className="mt-2 inline-flex rounded-md bg-background-default-subtle px-2 py-1 system-xs-medium text-text-secondary">
              {t(($) => $[`type.${contact.kind}`])}
            </span>
          </div>
          <div className="px-5 py-4">
            <h3 className="system-sm-semibold text-text-secondary">
              {t(($) => $['details.profile'])}
            </h3>
            <dl className="mt-2 divide-y divide-divider-subtle">
              <TypeSpecificDetails contact={contact} />
            </dl>
            <h3 className="mt-6 system-sm-semibold text-text-secondary">
              {t(($) => $['details.channels'])}
            </h3>
            <div className="mt-2 space-y-2">
              <div className="flex items-center gap-2 rounded-lg border border-divider-subtle p-3">
                <span aria-hidden className="i-ri-mail-line size-4 text-text-tertiary" />
                <span className="min-w-0 truncate system-sm-regular text-text-secondary">
                  {contact.channels.email}
                </span>
              </div>
              {contact.channels.imIdentities.map((identity) => (
                <div
                  key={`${identity.provider}-${identity.identity}`}
                  className="flex items-center gap-2 rounded-lg border border-divider-subtle p-3"
                >
                  <span aria-hidden className="i-ri-chat-3-line size-4 text-text-tertiary" />
                  <span className="system-xs-medium text-text-secondary">{identity.provider}</span>
                  <span className="min-w-0 truncate system-sm-regular text-text-tertiary">
                    {identity.identity}
                  </span>
                </div>
              ))}
            </div>
            <dl className="mt-6 border-t border-divider-subtle pt-2">
              <DetailRow
                label={t(($) => $['details.joined'])}
                value={new Date(contact.joinedAt).toLocaleDateString()}
              />
            </dl>
          </div>
        </div>
      )}
    </aside>
  )
}
