'use client'

import type { AccountWithRoleResponse as Member } from '@dify/contracts/api/console/workspaces/types.gen'
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
} from '@langgenius/dify-ui/alert-dialog'
import { Avatar, AvatarFallback, AvatarImage } from '@langgenius/dify-ui/avatar'
import { Button } from '@langgenius/dify-ui/button'
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
  const { t } = useTranslation(['contacts'])
  const context = useContactsFeatureContext()
  const removal = useRemoveContactMember()
  const [keepAsPlatformContact, setKeepAsPlatformContact] = useState(true)
  const [failed, setFailed] = useState(false)
  const resetMutation = removal.reset
  const { imBindingCentrallyManaged, imBindingCapabilityError, retryIMBindingCapability } = context
  const capabilityReady = imBindingCentrallyManaged !== undefined

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
    if (removal.isPending || !capabilityReady) return
    setFailed(false)
    const result = await removal.mutateAsync({
      keepAsPlatformContact: imBindingCentrallyManaged && keepAsPlatformContact,
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
        <AlertDialogHeader>
          <AlertDialogTitle>
            {t(($) => $['memberRemoval.title'], { memberName: member.name || member.email })}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {t(
              ($) =>
                $[
                  imBindingCentrallyManaged
                    ? 'memberRemoval.eeDescription'
                    : 'memberRemoval.standardDescription'
                ],
            )}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogBody className="flex flex-col gap-4">
          <div className="flex items-center gap-3 rounded-xl border border-divider-subtle bg-background-default-subtle p-3">
            <Avatar size="lg">
              <AvatarImage
                src={(member.avatar_url || null) ?? undefined}
                alt={member.name || member.email}
              />
              <AvatarFallback>
                {(member.name || member.email)?.[0]?.toLocaleUpperCase()}
              </AvatarFallback>
            </Avatar>
            <span className="min-w-0">
              <span className="block truncate system-sm-medium text-text-secondary">
                {member.name || member.email}
              </span>
              <span className="block truncate system-xs-regular text-text-tertiary">
                {member.email}
              </span>
            </span>
          </div>
          {imBindingCentrallyManaged && (
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
          {imBindingCapabilityError && (
            <div
              role="alert"
              className="rounded-lg bg-state-destructive-hover p-3 system-sm-regular text-text-destructive"
            >
              <p>{t(($) => $['directory.errorTitle'])}</p>
              {retryIMBindingCapability && (
                <Button variant="secondary" onClick={retryIMBindingCapability}>
                  {t(($) => $['action.retry'])}
                </Button>
              )}
            </div>
          )}
        </AlertDialogBody>
        <AlertDialogFooter>
          <AlertDialogCancelButton disabled={removal.isPending}>
            {t(($) => $['action.cancel'])}
          </AlertDialogCancelButton>
          <AlertDialogConfirmButton
            disabled={removal.isPending || !capabilityReady}
            onClick={handleRemove}
          >
            {removal.isPending
              ? t(($) => $['memberRemoval.removing'])
              : t(($) => $['memberRemoval.remove'])}
          </AlertDialogConfirmButton>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
