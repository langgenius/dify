'use client'

import { Button } from '@langgenius/dify-ui/button'
import { Checkbox } from '@langgenius/dify-ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogHeaderCloseButton,
  DialogTitle,
} from '@langgenius/dify-ui/dialog'
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { SearchInput } from '@/app/components/base/search-input'
import { consoleQuery } from '@/service/console'
import { availablePlatformCandidatesOptions } from './available-platform-candidates'
import { useContactsFeatureContext } from './composition-context'
import { ContactAvatar } from './contact-avatar'

function PlatformContactPickerContent({
  onOpenChange,
  onBusyChange,
}: {
  onOpenChange: (open: boolean) => void
  onBusyChange: (busy: boolean) => void
}) {
  const { t } = useTranslation(['contacts'])
  const context = useContactsFeatureContext()
  const [search, setSearch] = useState('')
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const searchRef = useRef<HTMLInputElement>(null)
  const canImport = Boolean(
    context.workspaceId && context.imCentrallyManaged && context.permissions.canManageContacts,
  )
  const api = consoleQuery.workspaces.current.humanInput.v2
  const queryClient = useQueryClient()
  const candidates = useInfiniteQuery({
    ...availablePlatformCandidatesOptions(queryClient, context.workspaceId, search),
    enabled: canImport,
  })
  const contacts = candidates.data?.pages.flatMap((page) => page.data) ?? []
  const pending = candidates.isPending
  const error = candidates.error
  const add = useMutation(api.contacts.platform.post.mutationOptions({ context: { silent: true } }))
  useEffect(() => {
    onBusyChange(add.isPending)
  }, [add.isPending, onBusyChange])

  function toggleContact(id: string, checked: boolean) {
    add.reset()
    setSelectedIds((current) =>
      checked ? [...new Set([...current, id])] : current.filter((candidate) => candidate !== id),
    )
  }
  const errorKey =
    add.error && 'status' in add.error && add.error.status === 403
      ? 'platformPicker.addForbidden'
      : add.error && 'status' in add.error && add.error.status === 409
        ? 'platformPicker.addConflict'
        : 'platformPicker.addFailed'
  return (
    <>
      <DialogHeader>
        <DialogTitle>{t(($) => $['platformPicker.title'])}</DialogTitle>
        <DialogDescription className="sr-only">
          {t(($) => $['platformPicker.description'])}
        </DialogDescription>
        <DialogHeaderCloseButton
          aria-label={t(($) => $['action.close'])}
          disabled={add.isPending}
        />
      </DialogHeader>
      <div className="shrink-0 px-2 pt-2 pb-1">
        <SearchInput
          ref={searchRef}
          aria-label={t(($) => $['platformPicker.search'])}
          className="h-8 bg-components-input-bg-normal shadow-none"
          disabled={add.isPending || !canImport}
          placeholder={t(($) => $['platformPicker.search'])}
          value={search}
          onValueChange={setSearch}
        />
      </div>
      <div className="flex h-7 shrink-0 items-center px-3 system-xs-regular text-text-tertiary">
        {t(($) => $['platformPicker.allMembers'])}
      </div>
      <p role="status" aria-atomic="true" className="sr-only">
        {selectedIds.length
          ? t(($) => $['platformPicker.selected'], { count: selectedIds.length })
          : !pending && !error
            ? t(($) => $['directory.resultCount'], { count: contacts.length })
            : ''}
      </p>
      <div className="min-h-0 flex-1 overflow-y-auto p-1" aria-busy={pending}>
        {!canImport && (
          <p role="alert" className="p-3 system-sm-regular">
            {t(($) => $['platformPicker.addForbidden'])}
          </p>
        )}
        {canImport && pending && (
          <div className="space-y-2 p-3">
            {[0, 1, 2].map((key) => (
              <div
                key={key}
                className="h-12 animate-pulse rounded-lg bg-background-default-subtle"
              />
            ))}
          </div>
        )}
        {error && !candidates.isFetchNextPageError && (
          <div
            role="alert"
            className="flex min-h-40 flex-col items-center justify-center gap-3 text-center"
          >
            <p className="system-sm-regular text-text-secondary">
              {t(($) => $['platformPicker.error'])}
            </p>
            <Button
              size="small"
              onClick={() => {
                void candidates.refetch()
              }}
            >
              {t(($) => $['action.retry'])}
            </Button>
          </div>
        )}
        {canImport && !pending && !error && contacts.length === 0 && (
          <p className="flex min-h-24 items-center justify-center p-3 text-center system-sm-regular text-text-tertiary">
            {t(($) => $['platformPicker.empty'])}
          </p>
        )}
        {canImport &&
          !pending &&
          contacts.map((contact) => (
            <label
              key={contact.id}
              className="group flex min-h-8 cursor-pointer items-center gap-2 rounded-lg py-1 ps-2 pe-3 focus-within:ring-2 focus-within:ring-state-accent-solid hover:bg-state-base-hover"
            >
              <Checkbox
                aria-label={t(($) => $['platformPicker.selectContact'], { name: contact.name })}
                checked={selectedIds.includes(contact.id)}
                disabled={add.isPending}
                onCheckedChange={(checked) => toggleContact(contact.id, checked)}
              />
              <ContactAvatar avatar={contact.avatar_url} name={contact.name} size="sm" />
              <span className="min-w-0 flex-1 truncate system-sm-medium text-text-secondary">
                {contact.name}
              </span>
              <span className="max-w-[55%] shrink-0 truncate system-xs-regular text-text-quaternary group-hover:text-text-tertiary">
                {contact.email}
              </span>
            </label>
          ))}
        {canImport && candidates.hasNextPage && (
          <div className="p-2">
            {candidates.isFetchNextPageError && (
              <p role="alert" className="mb-2 system-xs-regular text-text-destructive">
                {t(($) => $['platformPicker.error'])}
              </p>
            )}
            <Button
              disabled={add.isPending}
              loading={candidates.isFetchingNextPage}
              onClick={() => {
                void candidates.fetchNextPage().then((result) => {
                  if (!result.hasNextPage) searchRef.current?.focus()
                })
              }}
            >
              {candidates.isFetchNextPageError
                ? t(($) => $['action.retry'])
                : t(($) => $['action.loadMore'])}
            </Button>
          </div>
        )}
      </div>
      <div className="shrink-0 border-t border-divider-subtle px-3 py-2">
        {add.isError && (
          <p role="alert" className="mb-3 system-sm-regular text-text-destructive">
            {t(($) => $[errorKey])}
          </p>
        )}
        <div className="flex items-center justify-between gap-3">
          <span className="system-xs-regular text-text-tertiary">
            {t(($) => $['platformPicker.selected'], { count: selectedIds.length })}
          </span>
          <div className="flex gap-2">
            <Button disabled={add.isPending} onClick={() => onOpenChange(false)}>
              {t(($) => $['action.cancel'])}
            </Button>
            <Button
              variant="primary"
              disabled={!canImport || !selectedIds.length}
              loading={add.isPending}
              onClick={() => {
                if (canImport && selectedIds.length)
                  add.mutate(
                    { body: { candidate_ids: selectedIds } },
                    { onSuccess: () => onOpenChange(false) },
                  )
              }}
            >
              {t(($) => $['platformPicker.add'])}
            </Button>
          </div>
        </div>
      </div>
    </>
  )
}

export function PlatformContactPickerDialog({
  onOpenChange,
  open,
}: {
  onOpenChange: (open: boolean) => void
  open: boolean
}) {
  const [busy, setBusy] = useState(false)
  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!busy) onOpenChange(nextOpen)
      }}
      disablePointerDismissal={busy}
    >
      <DialogContent className="h-84 w-86.5 overflow-hidden">
        <PlatformContactPickerContent onOpenChange={onOpenChange} onBusyChange={setBusy} />
      </DialogContent>
    </Dialog>
  )
}
