'use client'

import type { Member } from '@/models/common'
import {
  AlertDialog,
  AlertDialogActions,
  AlertDialogCancelButton,
  AlertDialogConfirmButton,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from '@langgenius/dify-ui/alert-dialog'
import { Avatar } from '@langgenius/dify-ui/avatar'
import { Checkbox } from '@langgenius/dify-ui/checkbox'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useContactsFeatureContext } from './composition-context'
import { useRemoveContactMember } from './hooks'

export function MemberRemovalContactImpactDialog({
  member,
  onOpenChange,
  onRemoved,
  open,
}: {
  member: Member
  onOpenChange: (open: boolean) => void
  onRemoved: () => void
  open: boolean
}) {
  const { t } = useTranslation('contacts')
  const context = useContactsFeatureContext()
  const removal = useRemoveContactMember()
  const [keepAsPlatformContact, setKeepAsPlatformContact] = useState(true)
  const [failed, setFailed] = useState(false)
  const resetMutation = removal.reset
  const isEnterprise = context.deployment === 'ee'

  function resetDialog() {
    setKeepAsPlatformContact(true)
    setFailed(false)
    resetMutation()
  }

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen && removal.isPending) return
    onOpenChange(nextOpen)
    if (!nextOpen) resetDialog()
  }

  async function handleRemove() {
    if (removal.isPending) return
    setFailed(false)
    const result = await removal.mutateAsync({
      keepAsPlatformContact: isEnterprise && keepAsPlatformContact,
      memberId: member.id,
    })
    if (result.kind === 'failed') {
      setFailed(true)
      return
    }
    onOpenChange(false)
    onRemoved()
    resetDialog()
  }

  return (
    <AlertDialog open={open} onOpenChange={handleOpenChange}>
      <AlertDialogContent backdropProps={{ forceRender: true }}>
        <div className="flex flex-col gap-4 px-6 pt-6 pb-4">
          <div>
            <AlertDialogTitle className="w-full truncate title-2xl-semi-bold text-text-primary">
              {t(($) => $['memberRemoval.title'], { memberName: member.name || member.email })}
            </AlertDialogTitle>
            <AlertDialogDescription className="mt-2 w-full system-sm-regular wrap-break-word text-text-tertiary">
              {t(
                ($) =>
                  $[
                    isEnterprise
                      ? 'memberRemoval.eeDescription'
                      : 'memberRemoval.standardDescription'
                  ],
              )}
            </AlertDialogDescription>
          </div>
          <div className="flex items-center gap-3 rounded-xl border border-divider-subtle bg-background-default-subtle p-3">
            <Avatar
              avatar={member.avatar_url || null}
              name={member.name || member.email}
              size="lg"
            />
            <span className="min-w-0">
              <span className="block truncate system-sm-medium text-text-secondary">
                {member.name || member.email}
              </span>
              <span className="block truncate system-xs-regular text-text-tertiary">
                {member.email}
              </span>
            </span>
          </div>
          {isEnterprise && (
            <div className="flex items-start gap-2 rounded-lg p-1 focus-within:ring-2 focus-within:ring-state-accent-solid">
              <Checkbox
                aria-labelledby="member-removal-keep-platform-label"
                checked={keepAsPlatformContact}
                disabled={removal.isPending}
                onCheckedChange={setKeepAsPlatformContact}
              />
              <span>
                <span
                  id="member-removal-keep-platform-label"
                  className="block system-sm-medium text-text-secondary"
                >
                  {t(($) => $['memberRemoval.keepPlatform'])}
                </span>
                <span className="block system-xs-regular text-text-tertiary">
                  {t(($) => $['memberRemoval.keepPlatformDescription'])}
                </span>
              </span>
            </div>
          )}
          {failed && (
            <p
              role="alert"
              className="rounded-lg bg-state-destructive-hover p-3 system-sm-regular text-text-destructive"
            >
              {t(($) => $['memberRemoval.failed'])}
            </p>
          )}
        </div>
        <AlertDialogActions>
          <AlertDialogCancelButton disabled={removal.isPending}>
            {t(($) => $['action.cancel'])}
          </AlertDialogCancelButton>
          <AlertDialogConfirmButton disabled={removal.isPending} onClick={handleRemove}>
            {removal.isPending
              ? t(($) => $['memberRemoval.removing'])
              : t(($) => $['memberRemoval.remove'])}
          </AlertDialogConfirmButton>
        </AlertDialogActions>
      </AlertDialogContent>
    </AlertDialog>
  )
}
