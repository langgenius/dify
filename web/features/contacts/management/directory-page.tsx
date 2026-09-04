'use client'

import type { ReactNode } from 'react'
import type { ContactTypeFilter, ContactView } from './types'
import { Avatar } from '@langgenius/dify-ui/avatar'
import { Button } from '@langgenius/dify-ui/button'
import { Checkbox } from '@langgenius/dify-ui/checkbox'
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
import UserCommunityIcon from './assets/user-community.svg'
import { ContactChannelIcon } from './channel-icon'
import { getContactChannelLabel } from './channel-utils'
import { useContactsFeatureContext } from './composition-context'
import { ContactDetailsPanel } from './contact-details-panel'
import { ExternalContactDialog } from './external-contact-dialog'
import { useContactsDirectory, useRemoveContacts } from './hooks'
import { PlatformContactPickerDialog } from './platform-contact-picker-dialog'
import { formatContactRelativeTime } from './relative-time'

const contactKindFilters = ['all', 'workspace', 'platform', 'external'] as const
const searchParser = parseAsString.withDefault('')
const kindParser = parseAsStringLiteral(contactKindFilters).withDefault('all')
const contactIdParser = parseAsString
const loadedPagesParser = parseAsInteger.withDefault(1)

function ContactTypeLabel({ type }: { type: ContactView['type'] }) {
  const { t } = useTranslation('contacts')
  return (
    <span className="system-sm-regular text-text-secondary">{t(($) => $[`type.${type}`])}</span>
  )
}

function ContactRow({
  contact,
  onOpen,
  onSelectedChange,
  registerTrigger,
  selected,
  selectionPending,
  selectionEnabled,
}: {
  contact: ContactView
  onOpen: () => void
  onSelectedChange: (selected: boolean) => void
  registerTrigger: (element: HTMLButtonElement | null) => void
  selected: boolean
  selectionPending: boolean
  selectionEnabled: boolean
}) {
  const { i18n, t } = useTranslation('contacts')
  return (
    <tr className="h-12 border-b border-divider-subtle hover:bg-state-base-hover">
      {selectionEnabled && (
        <td className="w-8 px-2 py-2 text-center">
          <Checkbox
            aria-label={t(($) => $['directory.selectContact'], { name: contact.name })}
            checked={selected}
            disabled={contact.type === 'workspace' || selectionPending}
            onCheckedChange={onSelectedChange}
          />
        </td>
      )}
      <td className="p-0">
        <button
          ref={registerTrigger}
          type="button"
          aria-label={t(($) => $['directory.openDetails'], { name: contact.name })}
          className="flex w-full min-w-64 items-center gap-2.5 px-2 py-2 text-left focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden focus-visible:ring-inset"
          onClick={onOpen}
        >
          <Avatar avatar={contact.avatar_url || null} name={contact.name} size="md" />
          <span className="min-w-0">
            <span className="block truncate system-sm-medium text-text-secondary">
              {contact.name}
            </span>
            <span className="block truncate system-xs-regular text-text-tertiary">
              {contact.email}
            </span>
          </span>
        </button>
      </td>
      <td className="px-3 py-2">
        <ContactTypeLabel type={contact.type} />
      </td>
      <td className="px-3 py-2">
        <span className="flex items-center gap-1.5 text-text-tertiary">
          <span
            aria-label={t(($) => $['directory.channel.email'])}
            className="flex size-6 items-center justify-center rounded-md border border-divider-subtle bg-components-panel-on-panel-item-bg shadow-xs"
          >
            <ContactChannelIcon provider="email" />
          </span>
          {contact.im_bindings.map((binding) => (
            <span
              key={binding.id}
              aria-label={getContactChannelLabel(binding.provider)}
              className="flex size-6 items-center justify-center rounded-md border border-divider-subtle bg-components-panel-on-panel-item-bg shadow-xs"
            >
              <ContactChannelIcon provider={binding.provider} />
            </span>
          ))}
        </span>
      </td>
      <td className="px-3 py-2 system-sm-regular whitespace-nowrap text-text-tertiary">
        {formatContactRelativeTime(contact.created_at, i18n.resolvedLanguage ?? 'en')}
      </td>
    </tr>
  )
}

function DirectoryState({
  action,
  description,
  icon,
  iconSrc,
  title,
}: {
  action?: ReactNode
  description: string
  icon: string
  iconSrc?: string
  title: string
}) {
  return (
    <div className="flex min-h-full flex-col items-center justify-center px-6 py-16 text-center">
      <span className="flex size-14 items-center justify-center rounded-xl border border-dashed border-divider-regular">
        {iconSrc ? (
          <img alt="" aria-hidden className="size-6" src={iconSrc} />
        ) : (
          <span aria-hidden className={cn(icon, 'size-6 text-text-tertiary')} />
        )}
      </span>
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
  const [editingContact, setEditingContact] = useState<ContactView | null>(null)
  const [platformDialogOpen, setPlatformDialogOpen] = useState(false)
  const [selectedContactIds, setSelectedContactIds] = useState<string[]>([])
  const [removalError, setRemovalError] = useState(false)
  const rowTriggersRef = useRef(new Map<string, HTMLButtonElement>())
  const selectedContactIdRef = useRef<string | null>(null)
  const directoryQuery = useContactsDirectory({ kind, limit: 20, search })
  const removeContacts = useRemoveContacts()
  const fetchNextPage = directoryQuery.fetchNextPage
  const filters = contactKindFilters.filter(
    (filter) => filter !== 'platform' || context.deployment === 'ee',
  )
  const hasFilters = Boolean(search) || kind !== 'all'
  const currentPageCount = directoryQuery.data?.pages.length ?? 0
  const selectedContact = contactId
    ? directoryQuery.contacts.find((contact) => contact.id === contactId)
    : undefined
  const removableContactIds = directoryQuery.contacts
    .filter((contact) => contact.type !== 'workspace')
    .map((contact) => contact.id)
  const selectedRemovableCount = removableContactIds.filter((id) =>
    selectedContactIds.includes(id),
  ).length
  const allRemovableSelected =
    removableContactIds.length > 0 && selectedRemovableCount === removableContactIds.length
  const someRemovableSelected = selectedRemovableCount > 0 && !allRemovableSelected
  const contactCounts = contactKindFilters.reduce<Record<ContactTypeFilter, number>>(
    (counts, filter) => {
      counts[filter] =
        filter === 'all'
          ? directoryQuery.contacts.length
          : directoryQuery.contacts.filter((contact) => contact.type === filter).length
      return counts
    },
    { all: 0, external: 0, platform: 0, workspace: 0 },
  )

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
    setSelectedContactIds([])
    setRemovalError(false)
    void setBrowsing({ contact_pages: null, contact_search: value || null })
  }

  function updateKind(value: ContactTypeFilter) {
    setSelectedContactIds([])
    setRemovalError(false)
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
    setSelectedContactIds([])
    setRemovalError(false)
    void setBrowsing({ contact_kind: null, contact_pages: null, contact_search: null })
  }

  function toggleContact(contactId: string, selected: boolean) {
    setRemovalError(false)
    setSelectedContactIds((current) =>
      selected ? [...new Set([...current, contactId])] : current.filter((id) => id !== contactId),
    )
  }

  function toggleAllRemovable(selected: boolean) {
    setRemovalError(false)
    setSelectedContactIds((current) =>
      selected
        ? [...new Set([...current, ...removableContactIds])]
        : current.filter((id) => !removableContactIds.includes(id)),
    )
  }

  async function removeSelectedContacts() {
    if (!selectedContactIds.length || removeContacts.isPending) return
    setRemovalError(false)
    const result = await removeContacts.mutateAsync({ contactIds: selectedContactIds })
    if (result.kind === 'removed') {
      setSelectedContactIds([])
      return
    }
    setRemovalError(true)
  }

  async function removeContact(contactId: string) {
    const result = await removeContacts.mutateAsync({ contactIds: [contactId] })
    if (result.kind !== 'removed') {
      setRemovalError(true)
      return
    }
    closeDetails()
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
      <header className="shrink-0 px-4 pt-4 pb-2 sm:px-8">
        <div className="flex items-center gap-2">
          <h1 className="title-xl-semi-bold text-text-primary">{t(($) => $['directory.title'])}</h1>
          <a
            href="#contacts-help"
            className="ml-auto system-xs-regular text-text-tertiary hover:text-text-secondary hover:underline focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden"
          >
            {t(($) => $['directory.learnMore'])}
          </a>
        </div>
        <div className="mt-3.5 flex min-w-0 flex-col gap-3 lg:flex-row lg:items-center">
          <div
            role="group"
            aria-label={t(($) => $['directory.filters'])}
            className="flex max-w-full gap-1 overflow-x-auto rounded-lg bg-background-default-subtle p-1"
          >
            {filters.map((filter) => (
              <button
                key={filter}
                type="button"
                aria-label={t(($) => $[`filter.${filter}`])}
                aria-pressed={kind === filter}
                className={cn(
                  'h-7 rounded-md px-3 system-xs-medium whitespace-nowrap text-text-tertiary focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden',
                  kind === filter && 'bg-components-panel-bg text-text-secondary shadow-xs',
                )}
                onClick={() => updateKind(filter)}
              >
                <span>{t(($) => $[`filter.${filter}`])}</span>
                {filter !== 'all' && (
                  <span className="ml-1 text-text-quaternary">{contactCounts[filter]}</span>
                )}
              </button>
            ))}
          </div>
          <div className="relative min-w-0 flex-1 lg:max-w-50">
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
                  <DropdownMenuContent className="min-w-48">
                    <DropdownMenuItem className="gap-2" onClick={() => setPlatformDialogOpen(true)}>
                      <span
                        aria-hidden
                        className="i-ri-building-2-line size-4 text-text-tertiary"
                      />
                      {t(($) => $['directory.addFromPlatform'])}
                    </DropdownMenuItem>
                    <DropdownMenuItem className="gap-2" onClick={() => setExternalDialogOpen(true)}>
                      <span
                        aria-hidden
                        className="i-ri-contacts-book-line size-4 text-text-tertiary"
                      />
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
      <div className="flex min-h-0 flex-1 gap-1 overflow-hidden px-4 pb-1 sm:px-8">
        <div className="min-w-0 flex-1 overflow-auto rounded-xl bg-components-panel-bg">
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
                  hasFilters && !(kind === 'external' && !search) ? (
                    <Button onClick={clearFilters}>{t(($) => $['action.clearFilters'])}</Button>
                  ) : context.permissions.canManageContacts ? (
                    <Button onClick={() => setExternalDialogOpen(true)}>
                      <span aria-hidden className="mr-1 i-ri-add-line size-4" />
                      {t(($) => $['directory.addExternal'])}
                    </Button>
                  ) : undefined
                }
                description={t(
                  ($) =>
                    $[
                      hasFilters && !(kind === 'external' && !search)
                        ? 'directory.noResultsDescription'
                        : 'directory.externalEmptyDescription'
                    ],
                )}
                icon={hasFilters && !(kind === 'external' && !search) ? 'i-ri-search-line' : ''}
                iconSrc={
                  hasFilters && !(kind === 'external' && !search)
                    ? undefined
                    : UserCommunityIcon.src
                }
                title={t(
                  ($) =>
                    $[
                      hasFilters && !(kind === 'external' && !search)
                        ? 'directory.noResultsTitle'
                        : 'directory.externalEmptyTitle'
                    ],
                )}
              />
            )}
          {directoryQuery.contacts.length > 0 && (
            <div className="min-h-full overflow-hidden rounded-xl bg-components-panel-bg">
              <table className="w-full min-w-180 border-collapse">
                <colgroup>
                  {context.permissions.canManageContacts && <col className="w-8" />}
                  <col />
                  <col className="w-40" />
                  <col className="w-40" />
                  <col className="w-40" />
                </colgroup>
                <thead className="text-left system-xs-medium text-text-tertiary">
                  <tr>
                    {context.permissions.canManageContacts && (
                      <th scope="col" className="w-8 px-2 py-2 text-center">
                        <Checkbox
                          aria-label={t(($) => $['directory.selectAll'])}
                          checked={allRemovableSelected}
                          disabled={!removableContactIds.length || removeContacts.isPending}
                          indeterminate={someRemovableSelected}
                          onCheckedChange={toggleAllRemovable}
                        />
                      </th>
                    )}
                    <th scope="col" className="px-2 py-2">
                      {t(($) => $['directory.column.name'])}
                    </th>
                    <th scope="col" className="px-3 py-2">
                      {t(($) => $['directory.column.type'])}
                    </th>
                    <th scope="col" className="px-3 py-2">
                      {t(($) => $['directory.column.channels'])}
                    </th>
                    <th scope="col" className="px-3 py-2">
                      {t(($) => $['directory.column.joined'])}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {directoryQuery.contacts.map((contact) => (
                    <ContactRow
                      key={contact.id}
                      contact={contact}
                      selected={selectedContactIds.includes(contact.id)}
                      selectionEnabled={context.permissions.canManageContacts}
                      selectionPending={removeContacts.isPending}
                      registerTrigger={(element) => {
                        if (element) rowTriggersRef.current.set(contact.id, element)
                        else rowTriggersRef.current.delete(contact.id)
                      }}
                      onOpen={() => openDetails(contact.id)}
                      onSelectedChange={(selected) => toggleContact(contact.id, selected)}
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
        {selectedContact && (
          <ContactDetailsPanel
            contact={selectedContact}
            onClose={closeDetails}
            onEdit={() => {
              setEditingContact(selectedContact)
              setExternalDialogOpen(true)
            }}
            onRemove={() => void removeContact(selectedContact.id)}
          />
        )}
      </div>
      {selectedContactIds.length > 0 && (
        <div className="pointer-events-none absolute right-0 bottom-6 left-0 z-20 flex justify-center px-4">
          <div className="pointer-events-auto flex flex-col items-center gap-1">
            {removalError && (
              <p
                role="alert"
                className="rounded-md bg-state-destructive-hover px-3 py-1 system-xs-regular text-text-destructive"
              >
                {t(($) => $['directory.removalFailed'])}
              </p>
            )}
            <div
              aria-live="polite"
              className="flex items-center gap-1 rounded-[10px] border border-components-actionbar-border-accent bg-components-actionbar-bg-accent p-1 shadow-xl shadow-shadow-shadow-5 backdrop-blur-[5px]"
            >
              <div className="inline-flex items-center gap-2 py-1 pr-3 pl-2">
                <span className="flex size-5 items-center justify-center rounded-md bg-text-accent system-xs-medium text-text-primary-on-surface">
                  {selectedContactIds.length}
                </span>
                <span className="system-sm-semibold text-text-accent">
                  {t(($) => $['directory.selected'])}
                </span>
              </div>
              <span aria-hidden className="mx-0.5 h-3.5 w-px bg-divider-regular" />
              <Button
                variant="ghost"
                tone="destructive"
                className="gap-0.5 px-3"
                loading={removeContacts.isPending}
                onClick={removeSelectedContacts}
              >
                <span aria-hidden className="i-ri-delete-bin-line size-4" />
                {t(($) => $['directory.removeSelected'])}
              </Button>
              <Button
                variant="ghost"
                className="px-3"
                disabled={removeContacts.isPending}
                onClick={() => {
                  setSelectedContactIds([])
                  setRemovalError(false)
                }}
              >
                {t(($) => $['directory.cancelSelection'])}
              </Button>
            </div>
          </div>
        </div>
      )}
      <ExternalContactDialog
        key={editingContact?.id ?? 'create-external-contact'}
        contact={editingContact ?? undefined}
        open={externalDialogOpen}
        onOpenChange={(open) => {
          setExternalDialogOpen(open)
          if (!open) setEditingContact(null)
        }}
        onCreated={() => {}}
      />
      {context.deployment === 'ee' && (
        <PlatformContactPickerDialog
          open={platformDialogOpen}
          onOpenChange={setPlatformDialogOpen}
        />
      )}
    </main>
  )
}
