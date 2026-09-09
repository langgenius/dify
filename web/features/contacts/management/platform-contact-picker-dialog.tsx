'use client'

import { Avatar } from '@langgenius/dify-ui/avatar'
import { Button } from '@langgenius/dify-ui/button'
import { Checkbox } from '@langgenius/dify-ui/checkbox'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@langgenius/dify-ui/dialog'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { SearchInput } from '@/app/components/base/search-input'
import { useContactsFeatureContext, useContactsManagementRepository } from './composition-context'
import { useAddPlatformContacts, useAvailablePlatformContacts } from './hooks'
import { PlatformContactUpgradeDialog } from './platform-contact-upgrade-dialog'

export function PlatformContactPickerDialog({
  onOpenChange,
  open,
}: {
  onOpenChange: (open: boolean) => void
  open: boolean
}) {
  const { t } = useTranslation('contacts')
  const context = useContactsFeatureContext()
  const repository = useContactsManagementRepository()
  const [search, setSearch] = useState('')
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [mutationError, setMutationError] = useState<
    | 'platformPicker.addFailed'
    | 'platformPicker.addConflict'
    | 'platformPicker.addForbidden'
    | 'platformPicker.externalUpgradeUnsupported'
    | null
  >(null)
  const [upgradeConflictCount, setUpgradeConflictCount] = useState<number | null>(null)
  const availableContactsQuery = useAvailablePlatformContacts({ limit: 20, search }, open)
  const addPlatformContacts = useAddPlatformContacts()
  const resetMutation = addPlatformContacts.reset
  const canImport = Boolean(
    context.workspaceId &&
    context.deployment === 'ee' &&
    context.permissions.canManageContacts &&
    repository.supportsPlatformImport !== false,
  )

  function resetDialog() {
    setSearch('')
    setSelectedIds([])
    setMutationError(null)
    setUpgradeConflictCount(null)
    resetMutation()
  }

  function closeDialog() {
    if (addPlatformContacts.isPending) return
    onOpenChange(false)
    resetDialog()
  }

  function toggleContact(contactId: string, checked: boolean) {
    setMutationError(null)
    setSelectedIds((current) =>
      checked ? [...new Set([...current, contactId])] : current.filter((id) => id !== contactId),
    )
  }

  async function handleAdd(upgradeExternalContacts: boolean) {
    if (!canImport || !selectedIds.length || addPlatformContacts.isPending) return
    setMutationError(null)
    let result
    try {
      result = await addPlatformContacts.mutateAsync({
        contactIds: selectedIds,
        upgradeExternalContacts,
      })
    } catch {
      setMutationError('platformPicker.addFailed')
      return
    }
    if (result.kind === 'requires_external_contact_upgrade') {
      if (repository.supportsExternalContactUpgrade === false) {
        setMutationError('platformPicker.externalUpgradeUnsupported')
        return
      }
      setUpgradeConflictCount(result.conflicts.length)
      return
    }
    if (result.kind === 'added') {
      onOpenChange(false)
      resetDialog()
      return
    }
    setUpgradeConflictCount(null)
    setMutationError(
      result.kind === 'forbidden'
        ? 'platformPicker.addForbidden'
        : result.kind === 'conflict'
          ? 'platformPicker.addConflict'
          : result.kind === 'external_upgrade_unsupported'
            ? 'platformPicker.externalUpgradeUnsupported'
            : 'platformPicker.addFailed',
    )
  }

  function handleUpgradeDialogOpenChange(nextOpen: boolean) {
    if (nextOpen || addPlatformContacts.isPending) return
    setUpgradeConflictCount(null)
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => !nextOpen && closeDialog()}
      disablePointerDismissal={addPlatformContacts.isPending}
    >
      <DialogContent className="flex h-[336px] max-h-[calc(100dvh-2rem)] w-[346px] flex-col overflow-hidden! rounded-xl! p-0!">
        <DialogClose
          render={
            <IconButton
              aria-label={t(($) => $['action.close'])}
              className="sr-only"
              disabled={addPlatformContacts.isPending}
              size="lg"
            >
              <span aria-hidden className="i-ri-close-line size-4" />
            </IconButton>
          }
        />
        <div className="shrink-0 bg-components-panel-bg-blur px-2 pt-2 pb-1 backdrop-blur-sm">
          <DialogTitle className="sr-only">{t(($) => $['platformPicker.title'])}</DialogTitle>
          <DialogDescription className="sr-only">
            {t(($) => $['platformPicker.description'])}
          </DialogDescription>
          <div>
            <SearchInput
              aria-label={t(($) => $['platformPicker.search'])}
              className="h-8 border-0 bg-background-default-subtle shadow-none"
              disabled={addPlatformContacts.isPending || !canImport}
              placeholder={t(($) => $['platformPicker.search'])}
              value={search}
              onValueChange={setSearch}
            />
          </div>
          <div className="flex h-8 items-center px-1 system-xs-regular text-text-tertiary">
            {t(($) => $['platformPicker.allMembers'])}
          </div>
          {repository.supportsExternalContactUpgrade === false && (
            <p className="px-1 pb-2 system-xs-regular text-text-tertiary">
              {t(($) => $['platformPicker.noExternalUpgrade'])}
            </p>
          )}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto bg-components-panel-bg px-1 pb-1">
          {!canImport && (
            <p role="alert" className="p-3 system-sm-regular">
              {t(($) => $['platformPicker.addForbidden'])}
            </p>
          )}
          {canImport && availableContactsQuery.isPending && (
            <div
              role="status"
              className="space-y-2 p-3"
              aria-label={t(($) => $['platformPicker.loading'])}
            >
              {[0, 1, 2].map((key) => (
                <div
                  key={key}
                  className="h-12 animate-pulse rounded-lg bg-background-default-subtle"
                />
              ))}
            </div>
          )}
          {availableContactsQuery.isError && !availableContactsQuery.isFetchNextPageError && (
            <div
              role="alert"
              className="flex min-h-40 flex-col items-center justify-center gap-3 text-center"
            >
              <p className="system-sm-regular text-text-secondary">
                {t(($) => $['platformPicker.error'])}
              </p>
              <Button size="small" onClick={() => availableContactsQuery.refetch()}>
                {t(($) => $['action.retry'])}
              </Button>
            </div>
          )}
          {canImport &&
            !availableContactsQuery.isPending &&
            !availableContactsQuery.isError &&
            !availableContactsQuery.hasNextPage &&
            !availableContactsQuery.contacts.length && (
              <div className="flex min-h-40 items-center justify-center system-sm-regular text-text-tertiary">
                {t(($) => $['platformPicker.empty'])}
              </div>
            )}
          {canImport &&
            availableContactsQuery.contacts.map((contact) => {
              const selected = selectedIds.includes(contact.id)
              return (
                <label
                  key={contact.id}
                  htmlFor={`platform-contact-${contact.id}`}
                  className="flex h-8 cursor-pointer items-center gap-2 rounded-md px-2 focus-within:ring-2 focus-within:ring-state-accent-solid hover:bg-state-base-hover"
                >
                  <Checkbox
                    id={`platform-contact-${contact.id}`}
                    aria-label={t(($) => $['platformPicker.selectContact'], {
                      name: contact.name,
                    })}
                    checked={selected}
                    className="sr-only"
                    disabled={addPlatformContacts.isPending}
                    onCheckedChange={(checked) => toggleContact(contact.id, checked)}
                  />
                  <Avatar avatar={contact.avatar_url} name={contact.name} size="sm" />
                  <span className="truncate system-sm-regular text-text-secondary">
                    {contact.name}
                  </span>
                  <span className="ml-auto truncate system-xs-regular text-text-quaternary">
                    {contact.email}
                  </span>
                  {selected && (
                    <span aria-hidden className="i-ri-check-line size-4 text-text-accent" />
                  )}
                </label>
              )
            })}
          {canImport && availableContactsQuery.hasNextPage && (
            <div className="p-2">
              {availableContactsQuery.isFetchNextPageError && (
                <p role="alert" className="mb-2 system-xs-regular text-text-destructive">
                  {t(($) => $['platformPicker.error'])}
                </p>
              )}
              <Button
                disabled={addPlatformContacts.isPending}
                loading={availableContactsQuery.isFetchingNextPage}
                onClick={() => {
                  void availableContactsQuery.fetchNextPage()
                }}
              >
                {availableContactsQuery.isFetchNextPageError
                  ? t(($) => $['action.retry'])
                  : t(($) => $['action.loadMore'])}
              </Button>
            </div>
          )}
        </div>
        {(selectedIds.length > 0 || mutationError) && (
          <div className="shrink-0 border-t border-divider-subtle px-3 py-2">
            {mutationError && (
              <p role="alert" className="mb-3 system-sm-regular text-text-destructive">
                {t(($) => $[mutationError])}
              </p>
            )}
            <div className="flex items-center justify-between gap-3">
              <span aria-live="polite" className="system-xs-regular text-text-tertiary">
                {t(($) => $['platformPicker.selected'], { count: selectedIds.length })}
              </span>
              <div className="flex gap-2">
                <Button disabled={addPlatformContacts.isPending} onClick={closeDialog}>
                  {t(($) => $['action.cancel'])}
                </Button>
                <Button
                  variant="primary"
                  disabled={!canImport || !selectedIds.length}
                  loading={addPlatformContacts.isPending}
                  onClick={() => handleAdd(false)}
                >
                  {addPlatformContacts.isPending
                    ? t(($) => $['platformPicker.adding'])
                    : t(($) => $['platformPicker.add'])}
                </Button>
              </div>
            </div>
          </div>
        )}
      </DialogContent>
      <PlatformContactUpgradeDialog
        conflictCount={upgradeConflictCount ?? 0}
        open={repository.supportsExternalContactUpgrade !== false && upgradeConflictCount !== null}
        pending={addPlatformContacts.isPending}
        onOpenChange={handleUpgradeDialogOpenChange}
        onConfirm={() => handleAdd(true)}
      />
    </Dialog>
  )
}
