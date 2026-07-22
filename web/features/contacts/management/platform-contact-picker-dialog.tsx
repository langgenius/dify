'use client'

import { Avatar } from '@langgenius/dify-ui/avatar'
import { Button } from '@langgenius/dify-ui/button'
import { Checkbox } from '@langgenius/dify-ui/checkbox'
import {
  Dialog,
  DialogCloseButton,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@langgenius/dify-ui/dialog'
import { Input } from '@langgenius/dify-ui/input'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useAddPlatformContacts, useAvailablePlatformContacts } from './hooks'

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
  const availableContactsQuery = useAvailablePlatformContacts({ limit: 20, search }, open)
  const addPlatformContacts = useAddPlatformContacts()
  const resetMutation = addPlatformContacts.reset

  function resetDialog() {
    setSearch('')
    setSelectedIds([])
    setMutationError(false)
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

  async function handleAdd() {
    if (!selectedIds.length || addPlatformContacts.isPending) return
    const result = await addPlatformContacts.mutateAsync(selectedIds)
    if (result.kind === 'added') {
      onOpenChange(false)
      resetDialog()
      return
    }
    setMutationError(true)
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => !nextOpen && closeDialog()}
      disablePointerDismissal={addPlatformContacts.isPending}
    >
      <DialogContent className="flex max-h-[calc(100dvh-2rem)] w-120 flex-col overflow-hidden! p-0!">
        <DialogCloseButton
          aria-label={t(($) => $['action.close'])}
          disabled={addPlatformContacts.isPending}
        />
        <div className="shrink-0 px-6 pt-6 pb-4">
          <DialogTitle className="title-2xl-semi-bold text-text-primary">
            {t(($) => $['platformPicker.title'])}
          </DialogTitle>
          <DialogDescription className="mt-1 system-sm-regular text-text-tertiary">
            {t(($) => $['platformPicker.description'])}
          </DialogDescription>
          <div className="relative mt-4">
            <span
              aria-hidden
              className="absolute top-1/2 left-3 i-ri-search-line size-4 -translate-y-1/2 text-text-tertiary"
            />
            <Input
              aria-label={t(($) => $['platformPicker.search'])}
              className="pl-9"
              disabled={addPlatformContacts.isPending}
              placeholder={t(($) => $['platformPicker.search'])}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>
        </div>
        <div className="min-h-48 flex-1 overflow-y-auto border-y border-divider-subtle px-3 py-2">
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
          {availableContactsQuery.contacts.map((contact) => {
            const selected = selectedIds.includes(contact.id)
            return (
              <label
                key={contact.id}
                htmlFor={`platform-contact-${contact.id}`}
                className="flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 focus-within:ring-2 focus-within:ring-state-accent-solid hover:bg-state-base-hover"
              >
                <Checkbox
                  id={`platform-contact-${contact.id}`}
                  aria-label={t(($) => $['platformPicker.selectContact'], {
                    name: contact.name,
                  })}
                  checked={selected}
                  disabled={addPlatformContacts.isPending}
                  onCheckedChange={(checked) => toggleContact(contact.id, checked)}
                />
                <Avatar avatar={contact.avatar_url} name={contact.name} size="md" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate system-sm-medium text-text-secondary">
                    {contact.name}
                  </span>
                  <span className="block truncate system-xs-regular text-text-tertiary">
                    {contact.email}
                  </span>
                </span>
              </label>
            )
          })}
        </div>
        <div className="shrink-0 px-6 py-4">
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
                onClick={handleAdd}
              >
                {addPlatformContacts.isPending
                  ? t(($) => $['platformPicker.adding'])
                  : t(($) => $['platformPicker.add'])}
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
