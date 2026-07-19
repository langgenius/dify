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
import { useAddPlatformContacts, useOrganizationCandidates } from './hooks'

export function OrganizationPickerDialog({
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
  const candidatesQuery = useOrganizationCandidates({ pageSize: 20, search }, open)
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

  function toggleCandidate(candidateId: string, checked: boolean) {
    setMutationError(false)
    setSelectedIds((current) =>
      checked
        ? [...new Set([...current, candidateId])]
        : current.filter((id) => id !== candidateId),
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
            {t(($) => $['organization.title'])}
          </DialogTitle>
          <DialogDescription className="mt-1 system-sm-regular text-text-tertiary">
            {t(($) => $['organization.description'])}
          </DialogDescription>
          <div className="relative mt-4">
            <span
              aria-hidden
              className="absolute top-1/2 left-3 i-ri-search-line size-4 -translate-y-1/2 text-text-tertiary"
            />
            <Input
              aria-label={t(($) => $['organization.search'])}
              className="pl-9"
              disabled={addPlatformContacts.isPending}
              placeholder={t(($) => $['organization.search'])}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>
        </div>
        <div className="min-h-48 flex-1 overflow-y-auto border-y border-divider-subtle px-3 py-2">
          {candidatesQuery.isPending && (
            <div
              role="status"
              className="space-y-2 p-3"
              aria-label={t(($) => $['organization.loading'])}
            >
              {[0, 1, 2].map((key) => (
                <div
                  key={key}
                  className="h-12 animate-pulse rounded-lg bg-background-default-subtle"
                />
              ))}
            </div>
          )}
          {candidatesQuery.isError && (
            <div
              role="alert"
              className="flex min-h-40 flex-col items-center justify-center gap-3 text-center"
            >
              <p className="system-sm-regular text-text-secondary">
                {t(($) => $['organization.error'])}
              </p>
              <Button size="small" onClick={() => candidatesQuery.refetch()}>
                {t(($) => $['action.retry'])}
              </Button>
            </div>
          )}
          {!candidatesQuery.isPending &&
            !candidatesQuery.isError &&
            !candidatesQuery.candidates.length && (
              <div className="flex min-h-40 items-center justify-center system-sm-regular text-text-tertiary">
                {t(($) => $['organization.empty'])}
              </div>
            )}
          {candidatesQuery.candidates.map((candidate) => {
            const selected = selectedIds.includes(candidate.id)
            return (
              <label
                key={candidate.id}
                className="flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 focus-within:ring-2 focus-within:ring-state-accent-solid hover:bg-state-base-hover"
              >
                <Checkbox
                  aria-label={t(($) => $['organization.selectCandidate'], {
                    name: candidate.displayName,
                  })}
                  checked={selected}
                  disabled={addPlatformContacts.isPending}
                  onCheckedChange={(checked) => toggleCandidate(candidate.id, checked)}
                />
                <Avatar avatar={candidate.avatarUrl} name={candidate.displayName} size="md" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate system-sm-medium text-text-secondary">
                    {candidate.displayName}
                  </span>
                  <span className="block truncate system-xs-regular text-text-tertiary">
                    {candidate.email}
                  </span>
                </span>
                <span className="system-xs-regular text-text-tertiary">
                  {candidate.sourceWorkspaceSummary}
                </span>
              </label>
            )
          })}
        </div>
        <div className="shrink-0 px-6 py-4">
          {mutationError && (
            <p role="alert" className="mb-3 system-sm-regular text-text-destructive">
              {t(($) => $['organization.addFailed'])}
            </p>
          )}
          <div className="flex items-center justify-between gap-3">
            <span aria-live="polite" className="system-xs-regular text-text-tertiary">
              {t(($) => $['organization.selected'], { count: selectedIds.length })}
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
                  ? t(($) => $['organization.adding'])
                  : t(($) => $['organization.add'])}
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
