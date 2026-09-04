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
import { Input } from '@langgenius/dify-ui/input'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
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
  const [search, setSearch] = useState('')
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [mutationError, setMutationError] = useState(false)
  const [team, setTeam] = useState<'Backend Team' | 'Frontend Team' | null>(null)
  const [upgradeConflictCount, setUpgradeConflictCount] = useState<number | null>(null)
  const availableContactsQuery = useAvailablePlatformContacts({ limit: 20, search }, open)
  const addPlatformContacts = useAddPlatformContacts()
  const resetMutation = addPlatformContacts.reset
  const visibleContacts = team
    ? availableContactsQuery.contacts.filter((contact) => contact.departmentPath?.includes(team))
    : availableContactsQuery.contacts

  function resetDialog() {
    setSearch('')
    setSelectedIds([])
    setMutationError(false)
    setTeam(null)
    setUpgradeConflictCount(null)
    resetMutation()
  }

  function closeDialog() {
    if (addPlatformContacts.isPending) return
    onOpenChange(false)
    resetDialog()
  }

  function toggleContact(contactId: string, checked: boolean) {
    setMutationError(false)
    setSelectedIds((current) =>
      checked ? [...new Set([...current, contactId])] : current.filter((id) => id !== contactId),
    )
  }

  async function handleAdd(upgradeExternalContacts: boolean) {
    if (!selectedIds.length || addPlatformContacts.isPending) return
    setMutationError(false)
    const result = await addPlatformContacts.mutateAsync({
      contactIds: selectedIds,
      upgradeExternalContacts,
    })
    if (result.kind === 'requires_external_contact_upgrade') {
      setUpgradeConflictCount(result.conflicts.length)
      return
    }
    if (result.kind === 'added') {
      onOpenChange(false)
      resetDialog()
      return
    }
    setUpgradeConflictCount(null)
    setMutationError(true)
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
          <div className="relative">
            <span
              aria-hidden
              className="absolute top-1/2 left-3 i-ri-search-line size-4 -translate-y-1/2 text-text-tertiary"
            />
            <Input
              aria-label={t(($) => $['platformPicker.search'])}
              className="h-8 border-0 bg-background-default-subtle pl-8 shadow-none"
              disabled={addPlatformContacts.isPending}
              placeholder={t(($) => $['platformPicker.search'])}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>
          <div className="flex h-8 items-center gap-1 px-1 system-xs-regular">
            <button type="button" className="text-text-accent" onClick={() => setTeam(null)}>
              {t(($) => $['platformPicker.allMembers'])}
            </button>
            <span aria-hidden className="text-text-quaternary">
              /
            </span>
            <button type="button" className="text-text-accent" onClick={() => setTeam(null)}>
              {t(($) => $['platformPicker.devTeam'])}
            </button>
            <span aria-hidden className="text-text-quaternary">
              /
            </span>
            {team ? (
              <>
                <button type="button" className="text-text-accent" onClick={() => setTeam(null)}>
                  {t(($) => $['platformPicker.mobileDev'])}
                </button>
                <span aria-hidden className="text-text-quaternary">
                  /
                </span>
                <span className="text-text-tertiary">
                  {t(
                    ($) =>
                      $[
                        `platformPicker.${team === 'Frontend Team' ? 'frontendTeam' : 'backendTeam'}`
                      ],
                  )}
                </span>
              </>
            ) : (
              <span className="text-text-tertiary">{t(($) => $['platformPicker.mobileDev'])}</span>
            )}
          </div>
        </div>
        <div className="min-h-48 flex-1 overflow-y-auto bg-components-panel-bg px-1 pb-1">
          {availableContactsQuery.isPending && (
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
          {availableContactsQuery.isError && (
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
          {!availableContactsQuery.isPending &&
            !availableContactsQuery.isError &&
            !availableContactsQuery.contacts.length && (
              <div className="flex min-h-40 items-center justify-center system-sm-regular text-text-tertiary">
                {t(($) => $['platformPicker.empty'])}
              </div>
            )}
          {!team && !availableContactsQuery.isPending && !availableContactsQuery.isError && (
            <div className="border-b border-divider-subtle pb-1">
              {(
                [
                  { key: 'frontendTeam', pathSegment: 'Frontend Team' },
                  { key: 'backendTeam', pathSegment: 'Backend Team' },
                ] as const
              ).map((team) => {
                const teamName = t(($) => $[`platformPicker.${team.key}`])
                const count = availableContactsQuery.contacts.filter((contact) =>
                  contact.departmentPath?.includes(team.pathSegment),
                ).length
                return (
                  <button
                    key={team.key}
                    type="button"
                    className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-left hover:bg-state-base-hover focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden"
                    onClick={() => setTeam(team.pathSegment)}
                  >
                    <span className="flex size-6 items-center justify-center rounded-full bg-text-accent text-text-primary-on-surface">
                      <span aria-hidden className="i-ri-organization-chart size-3.5" />
                    </span>
                    <span className="system-sm-regular text-text-secondary">{teamName}</span>
                    <span className="system-xs-regular text-text-tertiary">{count}</span>
                    <span
                      aria-hidden
                      className="ml-auto i-ri-arrow-right-s-line size-4 text-text-quaternary"
                    />
                  </button>
                )
              })}
            </div>
          )}
          {visibleContacts.map((contact) => {
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
        </div>
        {(selectedIds.length > 0 || mutationError) && (
          <div className="shrink-0 border-t border-divider-subtle px-3 py-2">
            {mutationError && (
              <p role="alert" className="mb-3 system-sm-regular text-text-destructive">
                {t(($) => $['platformPicker.addFailed'])}
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
                  disabled={!selectedIds.length}
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
        open={upgradeConflictCount !== null}
        pending={addPlatformContacts.isPending}
        onOpenChange={handleUpgradeDialogOpenChange}
        onConfirm={() => handleAdd(true)}
      />
    </Dialog>
  )
}
