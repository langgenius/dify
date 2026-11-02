'use client'

import type { ReactNode } from 'react'
import type { ContactTypeFilter, ContactView } from './types'
import {
  AlertDialog,
  AlertDialogBody,
  AlertDialogCancelButton,
  AlertDialogConfirmButton,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@langgenius/dify-ui/alert-dialog'
import { Button } from '@langgenius/dify-ui/button'
import { Checkbox } from '@langgenius/dify-ui/checkbox'
import { cn } from '@langgenius/dify-ui/cn'
import { Menu, MenuContent, MenuItem, MenuTrigger } from '@langgenius/dify-ui/menu'
import {
  ScrollArea,
  ScrollAreaContent,
  ScrollAreaCorner,
  ScrollAreaScrollbar,
  ScrollAreaThumb,
  ScrollAreaViewport,
} from '@langgenius/dify-ui/scroll-area'
import {
  SegmentedControl,
  SegmentedControlDivider,
  SegmentedControlItem,
} from '@langgenius/dify-ui/segmented-control'
import {
  skipToken,
  useInfiniteQuery,
  useMutation,
  useQueries,
  useQuery,
} from '@tanstack/react-query'
import { parseAsString, parseAsStringLiteral, useQueryState, useQueryStates } from 'nuqs'
import { Fragment, useEffect, useId, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { InfiniteScrollSentinel } from '@/app/components/base/infinite-scroll-sentinel'
import { LoadingPlaceholder } from '@/app/components/base/loading-placeholder'
import { SearchInput } from '@/app/components/base/search-input'
import { consoleQuery } from '@/service/console'
import { isNotFoundError } from '@/service/http-error'
import UserCommunityIcon from './assets/user-community.svg'
import { ContactChannelIcon } from './channel-icon'
import { getContactChannelLabel } from './channel-utils'
import { useContactsFeatureContext } from './composition-context'
import { ContactAvatar } from './contact-avatar'
import { ContactDetailsPanel } from './contact-details-panel'
import { ExternalContactDialog } from './external-contact-dialog'
import { PlatformContactPickerDialog } from './platform-contact-picker-dialog'
import { formatContactRelativeTime } from './relative-time'

const contactKindFilters = ['all', 'workspace', 'platform', 'external'] as const
const searchParser = parseAsString.withDefault('')
const kindParser = parseAsStringLiteral(contactKindFilters).withDefault('all')
const contactIdParser = parseAsString

function ContactTypeLabel({ type }: { type: ContactView['type'] }) {
  const { t } = useTranslation(['contacts'])
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
  expanded,
  panelId,
}: {
  contact: ContactView
  onOpen: () => void
  onSelectedChange: (selected: boolean) => void
  registerTrigger: (element: HTMLButtonElement | null) => void
  selected: boolean
  selectionPending: boolean
  selectionEnabled: boolean
  expanded: boolean
  panelId: string
}) {
  const { i18n, t } = useTranslation(['contacts'])
  return (
    <tr className="relative isolate h-12 shadow-[inset_0_-1px_0_0_var(--color-divider-subtle)] hover:bg-state-base-hover">
      {selectionEnabled && (
        <td className="relative z-10 w-8 px-2 py-2 text-center">
          {contact.type !== 'workspace' && (
            <Checkbox
              aria-label={t(($) => $['directory.selectContact'], { name: contact.name })}
              checked={selected}
              disabled={selectionPending}
              onCheckedChange={onSelectedChange}
            />
          )}
        </td>
      )}
      <td className="p-0">
        <button
          ref={registerTrigger}
          type="button"
          aria-controls={panelId}
          aria-expanded={expanded}
          className="flex h-12 w-full min-w-64 cursor-pointer items-center gap-2.5 py-1 ps-3 pe-2 text-start after:absolute after:inset-0 after:content-[''] focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden focus-visible:ring-inset"
          onClick={onOpen}
        >
          <ContactAvatar avatar={contact.avatar_url} name={contact.name} size="md" />
          <span className="min-w-0 py-0.5">
            <span className="block truncate system-md-medium text-text-secondary">
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
        <span className="flex items-center gap-2 text-text-tertiary">
          <span
            role="img"
            aria-label={t(($) => $['directory.channel.email'])}
            className="flex size-6 items-center justify-center rounded-md border border-divider-regular bg-components-panel-on-panel-item-bg backdrop-blur-[4px]"
          >
            <ContactChannelIcon provider="email" />
          </span>
          {(contact.im_bindings ?? []).map((binding) => (
            <span
              key={binding.id}
              role="img"
              aria-label={getContactChannelLabel(binding.provider)}
              className="flex size-6 items-center justify-center rounded-md border border-divider-regular bg-components-panel-on-panel-item-bg backdrop-blur-[4px]"
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
  className,
  description,
  icon,
  iconSrc,
  title,
}: {
  action?: ReactNode
  className?: string
  description: string
  icon: string
  iconSrc?: string
  title: string
}) {
  return (
    <div
      className={cn(
        'flex min-h-full flex-1 flex-col items-center justify-center px-6 py-16 text-center',
        className,
      )}
    >
      <span className="flex size-14 items-center justify-center rounded-xl border border-dashed border-divider-regular bg-components-card-bg backdrop-blur-[6px]">
        {iconSrc ? (
          <img alt="" aria-hidden className="size-6" src={iconSrc} />
        ) : (
          <span aria-hidden className={cn(icon, 'size-6 text-text-tertiary')} />
        )}
      </span>
      <h2 className="mt-3 system-md-semibold text-text-secondary">{title}</h2>
      <p className="mt-1 max-w-120 system-sm-regular text-text-tertiary">{description}</p>
      {Boolean(action) && <div className="mt-3">{action}</div>}
    </div>
  )
}

function DirectoryLoading() {
  return (
    <div aria-busy="true" className="space-y-2 rounded-xl border border-divider-subtle p-3">
      {[0, 1, 2, 3, 4].map((key) => (
        <div key={key} className="h-12 animate-pulse rounded-lg bg-background-default-subtle" />
      ))}
    </div>
  )
}

export function ContactsDirectoryPage() {
  const { t } = useTranslation(['contacts'])
  const { t: tCommon } = useTranslation(['common'])
  const context = useContactsFeatureContext()
  const [browsing, setBrowsing] = useQueryStates({
    contact_kind: kindParser,
    contact_search: searchParser,
  })
  const search = browsing.contact_search
  const platformFilterUnavailable =
    browsing.contact_kind === 'platform' && context.imCentrallyManaged === false
  const kind = platformFilterUnavailable ? 'all' : browsing.contact_kind
  const [contactId, setContactId] = useQueryState('contact_id', contactIdParser)
  const [externalDialogOpen, setExternalDialogOpen] = useState(false)
  const [editingContact, setEditingContact] = useState<ContactView | null>(null)
  const [platformDialogOpen, setPlatformDialogOpen] = useState(false)
  const [selectedContactIds, setSelectedContactIds] = useState<string[]>([])
  const [removalTargetIds, setRemovalTargetIds] = useState<string[]>([])
  const [removalOpen, setRemovalOpen] = useState(false)
  const [removalContactName, setRemovalContactName] = useState<string>()
  const [removalError, setRemovalError] = useState(false)
  const pageHeadingId = useId()
  const detailsPanelId = useId()
  const searchRef = useRef<HTMLInputElement>(null)
  const detailsHeadingRef = useRef<HTMLHeadingElement>(null)
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const rowTriggersRef = useRef(new Map<string, HTMLButtonElement>())
  const selectedContactIdRef = useRef<string | null>(null)
  const api = consoleQuery.workspaces.current.humanInput.v2.contacts
  const directoryQuery = useInfiniteQuery(
    api.get.infiniteOptions({
      input: (page: number) => ({
        query: {
          page,
          limit: 20,
          group: kind === 'all' ? undefined : kind,
          keyword: search.trim() || undefined,
        },
      }),
      initialPageParam: 1,
      getNextPageParam: (page) => (page.page * page.limit < page.total ? page.page + 1 : undefined),
      enabled:
        Boolean(context.workspaceId) &&
        context.permissions.canViewContacts &&
        context.imCentrallyManaged !== undefined,
      context: { silent: true },
    }),
  )
  const contacts = [
    ...new Map(
      (directoryQuery.data?.pages.flatMap((page) => page.data) ?? []).map((contact) => [
        contact.id,
        contact,
      ]),
    ).values(),
  ]
  const detailsQuery = useQuery(
    api.byContactId.get.queryOptions({
      input:
        contactId && context.workspaceId && context.permissions.canViewContacts
          ? { params: { contact_id: contactId } }
          : skipToken,
      select: (response) => ({
        ...response.contact,
        im_binding_details: response.im_binding_details,
      }),
      retry: false,
      context: { silent: true },
    }),
  )
  const kinds = ['workspace', 'platform', 'external'] as const
  const counts = useQueries({
    queries: kinds.map((group) =>
      api.get.queryOptions({
        input: { query: { group, page: 1, limit: 1 } },
        enabled:
          Boolean(context.workspaceId) &&
          context.permissions.canViewContacts &&
          context.imCentrallyManaged !== undefined &&
          (group !== 'platform' || context.imCentrallyManaged === true),
        select: (page) => page.total,
        context: { silent: true },
      }),
    ),
  })
  const contactCounts = {
    workspace: counts[0]?.data,
    platform: counts[1]?.data,
    external: counts[2]?.data,
  }
  const removeContacts = useMutation(api.remove.post.mutationOptions({ context: { silent: true } }))
  const fetchNextPage = directoryQuery.fetchNextPage
  const filters = contactKindFilters.filter(
    (filter) => filter !== 'platform' || context.imCentrallyManaged,
  )
  const hasFilters = Boolean(search) || kind !== 'all'
  const selectedContact = detailsQuery.data
  const detailsFailed = detailsQuery.isError && !isNotFoundError(detailsQuery.error)
  const selectedContactId = selectedContact?.id
  const removableContactIds = contacts
    .filter((contact) => contact.type !== 'workspace')
    .map((contact) => contact.id)
  const selectedRemovableCount = removableContactIds.filter((id) =>
    selectedContactIds.includes(id),
  ).length
  const allRemovableSelected =
    removableContactIds.length > 0 && selectedRemovableCount === removableContactIds.length
  const someRemovableSelected = selectedRemovableCount > 0 && !allRemovableSelected

  useEffect(() => {
    if (platformFilterUnavailable) {
      // oxlint-disable-next-line eslint-react/set-state-in-effect -- The resolved server capability removes unsupported filters from the external URL query state.
      void setBrowsing({ contact_kind: null })
    }
  }, [platformFilterUnavailable, setBrowsing])

  useEffect(() => {
    if (contactId && selectedContactId) detailsHeadingRef.current?.focus()
  }, [contactId, selectedContactId])

  function focusDirectory(exclude: readonly string[] = []) {
    const next = contacts.find((contact) => !exclude.includes(contact.id))
    const trigger = next ? rowTriggersRef.current.get(next.id) : null
    return trigger?.isConnected ? trigger : searchRef.current
  }

  function openCreateContact() {
    setEditingContact(null)
    setExternalDialogOpen(true)
  }

  function updateSearch(value: string) {
    setSelectedContactIds([])
    setRemovalError(false)
    void setBrowsing({ contact_search: value || null })
  }

  function updateKind(value: ContactTypeFilter) {
    setSelectedContactIds([])
    setRemovalError(false)
    void setBrowsing({
      contact_kind: value === 'all' ? null : value,
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
    void setContactId(null).then(() => {
      if (trigger?.isConnected) trigger.focus()
      else searchRef.current?.focus()
    })
  }

  function clearFilters() {
    setSelectedContactIds([])
    setRemovalError(false)
    void setBrowsing({ contact_kind: null, contact_search: null })
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

  async function confirmRemoval() {
    if (
      !removalTargetIds?.length ||
      !context.permissions.canManageContacts ||
      removeContacts.isPending
    )
      return
    setRemovalError(false)
    try {
      const result = await removeContacts.mutateAsync({ body: { contact_ids: removalTargetIds } })
      setSelectedContactIds((current) =>
        current.filter((id) => !result.removed_contact_ids.includes(id)),
      )
      if (contactId && result.removed_contact_ids.includes(contactId)) void setContactId(null)
      setRemovalOpen(false)
    } catch {
      setRemovalError(true)
    }
  }

  async function loadMore() {
    await fetchNextPage({ cancelRefetch: false })
  }

  const stateHeader = (
    <h1 id={pageHeadingId} className="px-8 pt-4 title-2xl-semi-bold text-text-primary">
      {t(($) => $['directory.title'])}
    </h1>
  )
  if (!context.permissions.canViewContacts) {
    return (
      <div className="flex h-full flex-col">
        {stateHeader}
        <DirectoryState
          description={t(($) => $['directory.noAccessDescription'])}
          icon="i-ri-lock-2-line"
          title={t(($) => $['directory.noAccessTitle'])}
        />
      </div>
    )
  }

  if (context.imCentrallyManaged === undefined) {
    if (context.imCapabilityError) {
      return (
        <div className="flex h-full flex-col">
          {stateHeader}
          <DirectoryState
            action={
              <Button onClick={context.retryIMCapability}>{t(($) => $['action.retry'])}</Button>
            }
            description={t(($) => $['directory.errorDescription'])}
            icon="i-ri-error-warning-line"
            title={t(($) => $['directory.errorTitle'])}
          />
        </div>
      )
    }
    return (
      <div className="flex h-full flex-col">
        {stateHeader}
        <DirectoryLoading />
      </div>
    )
  }

  return (
    <div className="relative flex h-full min-w-0 flex-1 flex-col overflow-hidden bg-background-body">
      <div className="shrink-0 px-4 pt-4 pb-2 sm:px-8">
        <div className="flex h-6 items-center gap-2">
          <h1 id={pageHeadingId} className="title-2xl-semi-bold text-text-primary">
            {t(($) => $['directory.title'])}
          </h1>
        </div>
        <div className="mt-3.5 flex min-w-0 flex-col gap-2 lg:flex-row lg:items-center">
          <SegmentedControl
            aria-label={t(($) => $['directory.filters'])}
            className="max-w-full shrink-0 self-start overflow-x-auto"
            value={kind}
            onValueChange={updateKind}
          >
            {filters.map((filter, index) => (
              <Fragment key={filter}>
                <SegmentedControlItem value={filter} className="gap-1 px-2.5">
                  <span>{t(($) => $[`filter.${filter}`])}</span>
                  {filter !== 'all' && (
                    <span className="flex h-4 min-w-4 shrink-0 items-center justify-center rounded-[5px] bg-components-badge-bg-dimm px-1 system-2xs-medium-uppercase text-text-tertiary inset-ring-1 inset-ring-divider-deep">
                      {contactCounts[filter] ?? '—'}
                    </span>
                  )}
                </SegmentedControlItem>
                {index < filters.length - 1 && (
                  <SegmentedControlDivider className="has-[+_[data-checked]]:invisible [input:checked+&]:invisible" />
                )}
              </Fragment>
            ))}
          </SegmentedControl>
          <SearchInput
            ref={searchRef}
            aria-label={t(($) => $['directory.search'])}
            className="h-8 min-w-0 lg:w-50 lg:shrink-0"
            placeholder={t(($) => $['directory.search'])}
            value={search}
            onValueChange={updateSearch}
          />
          {context.permissions.canManageContacts && (
            <div className="flex shrink-0 lg:ms-auto">
              {context.imCentrallyManaged ? (
                <Menu>
                  <MenuTrigger render={<Button variant="primary" />}>
                    <span aria-hidden className="me-1 i-ri-add-line size-4" />
                    {t(($) => $['directory.addContact'])}
                    <span aria-hidden className="ms-1 i-ri-arrow-down-s-line size-4" />
                  </MenuTrigger>
                  <MenuContent className="min-w-48">
                    <MenuItem className="gap-2" onClick={() => setPlatformDialogOpen(true)}>
                      <span
                        aria-hidden
                        className="i-ri-building-2-line size-4 text-text-tertiary"
                      />
                      {t(($) => $['directory.addFromPlatform'])}
                    </MenuItem>
                    <MenuItem className="gap-2" onClick={openCreateContact}>
                      <span
                        aria-hidden
                        className="i-ri-contacts-book-line size-4 text-text-tertiary"
                      />
                      {t(($) => $['directory.addExternal'])}
                    </MenuItem>
                  </MenuContent>
                </Menu>
              ) : (
                <Button variant="primary" onClick={openCreateContact}>
                  <span aria-hidden className="me-1 i-ri-add-line size-4" />
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
      </div>
      <div className="flex min-h-0 flex-1 gap-1 overflow-hidden px-4 pt-1 pb-1 sm:px-8">
        <ScrollArea className="min-h-0 min-w-0 flex-1 overflow-hidden rounded-xl bg-components-panel-bg">
          <ScrollAreaViewport
            ref={scrollContainerRef}
            role="region"
            aria-labelledby={pageHeadingId}
            className="overscroll-contain"
          >
            <ScrollAreaContent
              className={cn('flex min-h-full flex-col', selectedContactIds.length > 0 && 'pb-24')}
            >
              {directoryQuery.isPending && <DirectoryLoading />}
              {directoryQuery.isError && !contacts.length && (
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
              {!directoryQuery.isPending && !directoryQuery.isError && !contacts.length && (
                <DirectoryState
                  action={
                    hasFilters && !(kind === 'external' && !search) ? (
                      <Button onClick={clearFilters}>{t(($) => $['action.clearFilters'])}</Button>
                    ) : context.permissions.canManageContacts ? (
                      <Button onClick={openCreateContact}>
                        <span aria-hidden className="i-ri-add-line size-4" />
                        {t(($) => $['directory.addExternal'])}
                      </Button>
                    ) : undefined
                  }
                  className={cn(!(hasFilters && !(kind === 'external' && !search)) && 'pt-1 pb-12')}
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
              {contacts.length > 0 && (
                <div className="min-h-full overflow-hidden rounded-xl bg-components-panel-bg px-1 pt-1.5">
                  <table
                    aria-labelledby={pageHeadingId}
                    className="w-full min-w-180 border-collapse"
                  >
                    <colgroup>
                      {context.permissions.canManageContacts && <col className="w-8" />}
                      <col />
                      <col className="w-40" />
                      <col className="w-40" />
                      <col className="w-40" />
                    </colgroup>
                    <thead className="text-start system-xs-medium-uppercase text-text-tertiary">
                      <tr className="h-7">
                        {context.permissions.canManageContacts && (
                          <th scope="col" className="w-8 px-2 text-center font-medium">
                            <Checkbox
                              aria-label={t(($) => $['directory.selectAll'])}
                              checked={allRemovableSelected}
                              disabled={!removableContactIds.length || removeContacts.isPending}
                              indeterminate={someRemovableSelected}
                              onCheckedChange={toggleAllRemovable}
                            />
                          </th>
                        )}
                        <th scope="col" className="ps-3 pe-2 font-medium">
                          {t(($) => $['directory.column.name'])}
                        </th>
                        <th scope="col" className="px-3 font-medium">
                          {t(($) => $['directory.column.type'])}
                        </th>
                        <th scope="col" className="px-3 font-medium">
                          {t(($) => $['directory.column.channels'])}
                        </th>
                        <th scope="col" className="px-3 font-medium">
                          {t(($) => $['directory.column.joined'])}
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {contacts.map((contact) => (
                        <ContactRow
                          key={contact.id}
                          contact={contact}
                          panelId={detailsPanelId}
                          expanded={contact.id === contactId}
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
                  {directoryQuery.isFetchingNextPage && <LoadingPlaceholder className="py-3" />}
                  {directoryQuery.hasNextPage && (
                    <>
                      {directoryQuery.isFetchNextPageError && (
                        <div className="flex flex-col items-center gap-2 p-3">
                          <p role="alert" className="system-xs-regular text-text-destructive">
                            {t(($) => $['directory.pageError'])}
                          </p>
                          <Button loading={directoryQuery.isFetchingNextPage} onClick={loadMore}>
                            {t(($) => $['action.retry'])}
                          </Button>
                        </div>
                      )}
                      <InfiniteScrollSentinel
                        canLoadMore={
                          !directoryQuery.isFetching && !directoryQuery.isFetchNextPageError
                        }
                        onLoadMore={() => void loadMore()}
                        preloadDistance={100}
                        scrollContainerRef={scrollContainerRef}
                      />
                    </>
                  )}
                </div>
              )}
            </ScrollAreaContent>
          </ScrollAreaViewport>
          <ScrollAreaScrollbar>
            <ScrollAreaThumb />
          </ScrollAreaScrollbar>
          <ScrollAreaScrollbar orientation="horizontal">
            <ScrollAreaThumb />
          </ScrollAreaScrollbar>
          <ScrollAreaCorner />
        </ScrollArea>
        {selectedContact && (
          <ContactDetailsPanel
            contact={selectedContact}
            id={detailsPanelId}
            headingRef={detailsHeadingRef}
            canManage={context.permissions.canManageContacts}
            removing={removeContacts.isPending}
            onClose={closeDetails}
            onEdit={() => {
              setEditingContact(selectedContact)
              setExternalDialogOpen(true)
            }}
            onRemove={() => {
              setRemovalError(false)
              setRemovalTargetIds([selectedContact.id])
              setRemovalContactName(selectedContact.name)
              setRemovalOpen(true)
            }}
          />
        )}
        {contactId && !selectedContact && (
          <section
            id={detailsPanelId}
            aria-label={t(($) => $['details.title'])}
            className="flex h-full w-80 max-w-full shrink-0 flex-col rounded-xl border border-divider-subtle bg-components-panel-bg p-4"
          >
            <Button className="self-end" variant="ghost" onClick={closeDetails}>
              {t(($) => $['action.close'])}
            </Button>
            {detailsQuery.isPending ? (
              <div aria-busy="true" className="my-auto space-y-4">
                <div className="mx-auto size-24 animate-pulse rounded-full bg-background-default-subtle" />
                <div className="h-6 animate-pulse rounded-lg bg-background-default-subtle" />
                <div className="h-12 animate-pulse rounded-lg bg-background-default-subtle" />
              </div>
            ) : (
              <p
                role={detailsQuery.isError ? 'alert' : undefined}
                className="my-auto text-center system-sm-regular text-text-tertiary"
              >
                {t(($) => $[detailsFailed ? 'details.error' : 'details.notFound'])}
              </p>
            )}
            {detailsFailed && (
              <Button onClick={() => detailsQuery.refetch()}>{t(($) => $['action.retry'])}</Button>
            )}
          </section>
        )}
      </div>
      <p role="status" aria-atomic="true" className="sr-only">
        {selectedContactIds.length
          ? t(($) => $['platformPicker.selected'], { count: selectedContactIds.length })
          : !directoryQuery.isPending && !directoryQuery.isError
            ? t(($) => $['directory.resultCount'], {
                count: directoryQuery.data?.pages[0]?.total ?? 0,
              })
            : ''}
      </p>
      <AlertDialog
        open={removalOpen}
        onOpenChange={(open) => {
          if (removeContacts.isPending) return
          setRemovalError(false)
          setRemovalOpen(open)
          if (open) {
            setRemovalTargetIds([...selectedContactIds])
            setRemovalContactName(undefined)
          }
        }}
      >
        {selectedContactIds.length > 0 && (
          <div className="pointer-events-none absolute inset-s-0 inset-e-0 bottom-6 z-20 flex justify-center px-4">
            <div className="pointer-events-auto flex flex-col items-center gap-1">
              <div className="flex items-center gap-1 rounded-[10px] border border-components-actionbar-border-accent bg-components-actionbar-bg-accent p-1 shadow-xl shadow-shadow-shadow-5 backdrop-blur-[5px]">
                <div className="inline-flex items-center gap-2 py-1 ps-2 pe-3">
                  <span className="flex size-5 items-center justify-center rounded-md bg-text-accent system-xs-medium text-text-primary-on-surface">
                    {selectedContactIds.length}
                  </span>
                  <span className="system-sm-semibold text-text-accent">
                    {t(($) => $['directory.selected'])}
                  </span>
                </div>
                <span aria-hidden className="mx-0.5 h-3.5 w-px bg-divider-regular" />
                <AlertDialogTrigger
                  render={
                    <Button
                      variant="ghost"
                      tone="destructive"
                      className="gap-0.5 px-3"
                      loading={removeContacts.isPending}
                    />
                  }
                >
                  <span aria-hidden className="i-ri-delete-bin-line size-4" />
                  {t(($) => $['directory.removeSelected'])}
                </AlertDialogTrigger>
                <Button
                  variant="ghost"
                  className="px-3"
                  disabled={removeContacts.isPending}
                  onClick={() => {
                    focusDirectory()?.focus()
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
        <AlertDialogContent
          finalFocus={() => focusDirectory(removalTargetIds)}
          backdropProps={{ forceRender: true }}
        >
          <AlertDialogHeader>
            <AlertDialogTitle>
              {removalContactName
                ? t(($) => $['directory.removalSingleTitle'], { name: removalContactName })
                : t(($) => $['directory.removalCountTitle'], { count: removalTargetIds.length })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {removalContactName
                ? t(($) => $['directory.removalSingleDescription'], { name: removalContactName })
                : t(($) => $['directory.removalDescription'])}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {removalError && (
            <AlertDialogBody>
              <p role="alert" className="system-sm-regular text-text-destructive">
                {t(
                  ($) =>
                    $[
                      removalContactName
                        ? 'directory.removalSingleFailed'
                        : 'directory.removalFailed'
                    ],
                )}
              </p>
            </AlertDialogBody>
          )}
          <AlertDialogFooter>
            <AlertDialogCancelButton disabled={removeContacts.isPending}>
              {tCommon(($) => $['operation.cancel'])}
            </AlertDialogCancelButton>
            <AlertDialogConfirmButton loading={removeContacts.isPending} onClick={confirmRemoval}>
              {t(($) => $['directory.removeSelected'])}
            </AlertDialogConfirmButton>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <ExternalContactDialog
        contact={editingContact ?? undefined}
        open={externalDialogOpen}
        onOpenChange={(open) => {
          setExternalDialogOpen(open)
        }}
        onCreated={openDetails}
      />
      {context.imCentrallyManaged && (
        <PlatformContactPickerDialog
          open={platformDialogOpen}
          onOpenChange={setPlatformDialogOpen}
        />
      )}
    </div>
  )
}
