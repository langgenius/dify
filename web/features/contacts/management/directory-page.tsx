'use client'

import type { ReactNode } from 'react'
import type { ContactKindFilter, ContactView } from './types'
import { Avatar } from '@langgenius/dify-ui/avatar'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@langgenius/dify-ui/dropdown-menu'
import { Input } from '@langgenius/dify-ui/input'
import {
  parseAsInteger,
  parseAsString,
  parseAsStringLiteral,
  useQueryState,
  useQueryStates,
} from 'nuqs'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useContactsFeatureContext } from './composition-context'
import { ContactDetailsPanel } from './contact-details-panel'
import { ExternalContactDialog } from './external-contact-dialog'
import { useContactsDirectory } from './hooks'
import { OrganizationPickerDialog } from './organization-picker-dialog'

const contactKindFilters = ['all', 'workspace', 'platform', 'external'] as const
const searchParser = parseAsString.withDefault('')
const kindParser = parseAsStringLiteral(contactKindFilters).withDefault('all')
const contactIdParser = parseAsString
const loadedPagesParser = parseAsInteger.withDefault(1)

function ContactTypeBadge({ kind }: { kind: ContactView['kind'] }) {
  const { t } = useTranslation('contacts')
  return (
    <span
      className={cn(
        'inline-flex rounded-md px-2 py-1 system-xs-medium',
        kind === 'workspace' && 'bg-state-accent-hover text-text-accent',
        kind === 'platform' && 'bg-state-success-hover text-text-success',
        kind === 'external' && 'bg-background-default-subtle text-text-tertiary',
      )}
    >
      {t(($) => $[`type.${kind}`])}
    </span>
  )
}

function ContactRow({
  contact,
  onOpen,
  registerTrigger,
}: {
  contact: ContactView
  onOpen: () => void
  registerTrigger: (element: HTMLButtonElement | null) => void
}) {
  const { t } = useTranslation('contacts')
  return (
    <tr className="border-b border-divider-subtle hover:bg-state-base-hover">
      <td className="p-0">
        <button
          ref={registerTrigger}
          type="button"
          aria-label={t(($) => $['directory.openDetails'], { name: contact.displayName })}
          className="flex w-full min-w-64 items-center gap-3 px-4 py-3 text-left focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden focus-visible:ring-inset"
          onClick={onOpen}
        >
          <Avatar avatar={contact.avatarUrl} name={contact.displayName} size="md" />
          <span className="min-w-0">
            <span className="block truncate system-sm-medium text-text-secondary">
              {contact.displayName}
            </span>
            <span className="block truncate system-xs-regular text-text-tertiary">
              {contact.email}
            </span>
          </span>
        </button>
      </td>
      <td className="px-4 py-3">
        <ContactTypeBadge kind={contact.kind} />
      </td>
      <td className="px-4 py-3">
        <span className="flex items-center gap-2 text-text-tertiary">
          <span
            aria-label={t(($) => $['directory.channel.email'])}
            className="i-ri-mail-line size-4"
          />
          {contact.channels.imIdentities.map((identity) => (
            <span
              key={`${identity.provider}-${identity.identity}`}
              className="system-xs-medium text-text-secondary"
            >
              {identity.provider}
            </span>
          ))}
        </span>
      </td>
      <td className="px-4 py-3 system-xs-regular whitespace-nowrap text-text-tertiary">
        {new Date(contact.joinedAt).toLocaleDateString()}
      </td>
    </tr>
  )
}

function DirectoryState({
  action,
  description,
  icon,
  title,
}: {
  action?: ReactNode
  description: string
  icon: string
  title: string
}) {
  return (
    <div className="flex min-h-80 flex-col items-center justify-center px-6 text-center">
      <span aria-hidden className={cn(icon, 'size-8 text-text-quaternary')} />
      <h2 className="mt-3 system-md-semibold text-text-secondary">{title}</h2>
      <p className="mt-1 max-w-md system-sm-regular text-text-tertiary">{description}</p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}

export function ContactsDirectoryPage() {
  const { t } = useTranslation('contacts')
  const context = useContactsFeatureContext()
  const [browsing, setBrowsing] = useQueryStates({
    contact_kind: kindParser,
    contact_pages: loadedPagesParser,
    contact_search: searchParser,
  })
  const search = browsing.contact_search
  const kind = browsing.contact_kind
  const loadedPages = browsing.contact_pages
  const [contactId, setContactId] = useQueryState('contact_id', contactIdParser)
  const [externalDialogOpen, setExternalDialogOpen] = useState(false)
  const [organizationDialogOpen, setOrganizationDialogOpen] = useState(false)
  const rowTriggersRef = useRef(new Map<string, HTMLButtonElement>())
  const selectedContactIdRef = useRef<string | null>(null)
  const directoryQuery = useContactsDirectory({ kind, pageSize: 20, search })
  const fetchNextPage = directoryQuery.fetchNextPage
  const filters = contactKindFilters.filter(
    (filter) => filter !== 'platform' || context.deployment === 'ee',
  )
  const hasFilters = Boolean(search) || kind !== 'all'
  const currentPageCount = directoryQuery.data?.pages.length ?? 0

  useEffect(() => {
    if (
      currentPageCount > 0 &&
      currentPageCount < loadedPages &&
      directoryQuery.hasNextPage &&
      !directoryQuery.isFetchingNextPage &&
      !directoryQuery.isFetchNextPageError
    ) {
      void fetchNextPage()
    }
  }, [
    currentPageCount,
    directoryQuery.hasNextPage,
    directoryQuery.isFetchNextPageError,
    directoryQuery.isFetchingNextPage,
    fetchNextPage,
    loadedPages,
  ])

  function updateSearch(value: string) {
    void setBrowsing({ contact_pages: null, contact_search: value || null })
  }

  function updateKind(value: ContactKindFilter) {
    void setBrowsing({
      contact_kind: value === 'all' ? null : value,
      contact_pages: null,
    })
  }

  function openDetails(id: string) {
    selectedContactIdRef.current = id
    void setContactId(id)
  }

  function closeDetails() {
    const trigger = selectedContactIdRef.current
      ? rowTriggersRef.current.get(selectedContactIdRef.current)
      : null
    void setContactId(null).then(() => trigger?.focus())
  }

  function clearFilters() {
    void setBrowsing({ contact_kind: null, contact_pages: null, contact_search: null })
  }

  async function loadMore() {
    const nextResult = await fetchNextPage()
    if (!nextResult.isFetchNextPageError)
      void setBrowsing({ contact_pages: nextResult.data?.pages.length ?? loadedPages })
  }

  if (!context.permissions.canViewContacts) {
    return (
      <DirectoryState
        description={t(($) => $['directory.noAccessDescription'])}
        icon="i-ri-lock-2-line"
        title={t(($) => $['directory.noAccessTitle'])}
      />
    )
  }

  return (
    <main className="relative flex h-full min-w-0 flex-1 flex-col overflow-hidden bg-background-body">
      <header className="shrink-0 px-4 pt-5 pb-3 sm:px-8">
        <div className="flex items-center gap-2">
          <h1 className="title-xl-semi-bold text-text-primary">{t(($) => $['directory.title'])}</h1>
          <a
            href="#contacts-help"
            className="system-xs-medium text-text-accent hover:underline focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden"
          >
            {t(($) => $['directory.learnMore'])}
          </a>
        </div>
        <div className="mt-4 flex min-w-0 flex-col gap-3 lg:flex-row lg:items-center">
          <div
            role="group"
            aria-label={t(($) => $['directory.filters'])}
            className="flex max-w-full gap-1 overflow-x-auto rounded-lg bg-background-default-subtle p-1"
          >
            {filters.map((filter) => (
              <button
                key={filter}
                type="button"
                aria-pressed={kind === filter}
                className={cn(
                  'h-7 rounded-md px-3 system-xs-medium whitespace-nowrap text-text-tertiary focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden',
                  kind === filter && 'bg-components-panel-bg text-text-secondary shadow-xs',
                )}
                onClick={() => updateKind(filter)}
              >
                {t(($) => $[`filter.${filter}`])}
              </button>
            ))}
          </div>
          <div className="relative min-w-0 flex-1 lg:max-w-60">
            <span
              aria-hidden
              className="absolute top-1/2 left-3 i-ri-search-line size-4 -translate-y-1/2 text-text-tertiary"
            />
            <Input
              aria-label={t(($) => $['directory.search'])}
              className="w-full pl-9"
              placeholder={t(($) => $['directory.search'])}
              value={search}
              onChange={(event) => updateSearch(event.target.value)}
            />
          </div>
          {context.permissions.canManageContacts && (
            <div className="flex shrink-0 lg:ml-auto">
              {context.deployment === 'ee' ? (
                <DropdownMenu>
                  <DropdownMenuTrigger render={<Button variant="primary" />}>
                    <span aria-hidden className="mr-1 i-ri-add-line size-4" />
                    {t(($) => $['directory.addContact'])}
                    <span aria-hidden className="ml-1 i-ri-arrow-down-s-line size-4" />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent popupClassName="min-w-48">
                    <DropdownMenuItem onClick={() => setOrganizationDialogOpen(true)}>
                      {t(($) => $['directory.addFromPlatform'])}
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => setExternalDialogOpen(true)}>
                      {t(($) => $['directory.addExternal'])}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : (
                <Button variant="primary" onClick={() => setExternalDialogOpen(true)}>
                  <span aria-hidden className="mr-1 i-ri-add-line size-4" />
                  {t(($) => $['directory.addExternal'])}
                </Button>
              )}
            </div>
          )}
        </div>
        {!context.permissions.canManageContacts && (
          <p className="mt-3 system-xs-regular text-text-tertiary">
            {t(($) => $['directory.viewOnly'])}
          </p>
        )}
      </header>
      <div className="min-h-0 flex-1 overflow-auto px-4 pb-6 sm:px-8">
        {directoryQuery.isPending && (
          <div
            role="status"
            aria-label={t(($) => $['directory.loading'])}
            className="space-y-2 rounded-xl border border-divider-subtle p-3"
          >
            {[0, 1, 2, 3, 4].map((key) => (
              <div
                key={key}
                className="h-12 animate-pulse rounded-lg bg-background-default-subtle"
              />
            ))}
          </div>
        )}
        {directoryQuery.isError && !directoryQuery.contacts.length && (
          <DirectoryState
            action={
              <Button onClick={() => directoryQuery.refetch()}>
                {t(($) => $['action.retry'])}
              </Button>
            }
            description={t(($) => $['directory.errorDescription'])}
            icon="i-ri-error-warning-line"
            title={t(($) => $['directory.errorTitle'])}
          />
        )}
        {!directoryQuery.isPending &&
          !directoryQuery.isError &&
          !directoryQuery.contacts.length && (
            <DirectoryState
              action={
                hasFilters ? (
                  <Button onClick={clearFilters}>{t(($) => $['action.clearFilters'])}</Button>
                ) : undefined
              }
              description={t(
                ($) =>
                  $[hasFilters ? 'directory.noResultsDescription' : 'directory.emptyDescription'],
              )}
              icon={hasFilters ? 'i-ri-search-line' : 'i-ri-contacts-book-2-line'}
              title={t(($) => $[hasFilters ? 'directory.noResultsTitle' : 'directory.emptyTitle'])}
            />
          )}
        {directoryQuery.contacts.length > 0 && (
          <div className="overflow-hidden rounded-xl border border-divider-subtle bg-components-panel-bg">
            <table className="w-full min-w-180 border-collapse">
              <thead className="bg-background-default-subtle text-left system-xs-medium text-text-tertiary">
                <tr>
                  <th scope="col" className="px-4 py-2">
                    {t(($) => $['directory.column.name'])}
                  </th>
                  <th scope="col" className="px-4 py-2">
                    {t(($) => $['directory.column.type'])}
                  </th>
                  <th scope="col" className="px-4 py-2">
                    {t(($) => $['directory.column.channels'])}
                  </th>
                  <th scope="col" className="px-4 py-2">
                    {t(($) => $['directory.column.joined'])}
                  </th>
                </tr>
              </thead>
              <tbody>
                {directoryQuery.contacts.map((contact) => (
                  <ContactRow
                    key={contact.id}
                    contact={contact}
                    registerTrigger={(element) => {
                      if (element) rowTriggersRef.current.set(contact.id, element)
                      else rowTriggersRef.current.delete(contact.id)
                    }}
                    onOpen={() => openDetails(contact.id)}
                  />
                ))}
              </tbody>
            </table>
            {directoryQuery.hasNextPage && (
              <div className="flex flex-col items-center border-t border-divider-subtle p-3">
                {directoryQuery.isFetchNextPageError && (
                  <p role="alert" className="mb-2 system-xs-regular text-text-destructive">
                    {t(($) => $['directory.pageError'])}
                  </p>
                )}
                <Button loading={directoryQuery.isFetchingNextPage} onClick={loadMore}>
                  {t(($) => $['action.loadMore'])}
                </Button>
              </div>
            )}
          </div>
        )}
      </div>
      {contactId && <ContactDetailsPanel contactId={contactId} onClose={closeDetails} />}
      <ExternalContactDialog
        open={externalDialogOpen}
        onOpenChange={setExternalDialogOpen}
        onCreated={() => {}}
      />
      {context.deployment === 'ee' && (
        <OrganizationPickerDialog
          open={organizationDialogOpen}
          onOpenChange={setOrganizationDialogOpen}
        />
      )}
    </main>
  )
}
