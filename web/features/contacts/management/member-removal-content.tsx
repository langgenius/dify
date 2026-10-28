'use client'

import type { AccountWithRoleResponse as Member } from '@dify/contracts/api/console/workspaces/types.gen'
import type { useRemoveContactMember } from './hooks'
import {
  AlertDialogBody,
  AlertDialogCancelButton,
  AlertDialogConfirmButton,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@langgenius/dify-ui/alert-dialog'
import { Avatar, AvatarFallback, AvatarImage } from '@langgenius/dify-ui/avatar'
import { Button } from '@langgenius/dify-ui/button'
import { Checkbox } from '@langgenius/dify-ui/checkbox'
import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useContactsFeatureContext } from './composition-context'

export function MemberRemovalContactImpactContent({
  member,
  removal,
  onRemoved,
}: {
  member: Member
  removal: ReturnType<typeof useRemoveContactMember>
  onRemoved: () => void
}) {
  const { t } = useTranslation(['contacts'])
  const context = useContactsFeatureContext()
  const [keepAsPlatformContact, setKeepAsPlatformContact] = useState(true)
  const removeLabelId = useId()
  const failed = removal.isError || removal.data?.kind === 'failed'
  const { imCentrallyManaged, imCapabilityError, retryIMCapability } = context
  const capabilityReady = imCentrallyManaged !== undefined

  function handleRemove() {
    if (removal.isPending || !capabilityReady) return
    removal.mutate(
      {
        keepAsPlatformContact: imCentrallyManaged && keepAsPlatformContact,
        memberId: member.id,
      },
      {
        onSuccess: (result) => {
          if (result.kind === 'removed') onRemoved()
        },
      },
    )
  }

  return (
    <>
      <AlertDialogHeader>
        <AlertDialogTitle>
          {t(($) => $['memberRemoval.title'], { memberName: member.name || member.email })}
        </AlertDialogTitle>
        <AlertDialogDescription>
          {t(
            ($) =>
              $[
                imCentrallyManaged
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
        {imCentrallyManaged && (
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
        {imCapabilityError && (
          <div
            role="alert"
            className="rounded-lg bg-state-destructive-hover p-3 system-sm-regular text-text-destructive"
          >
            <p>{t(($) => $['directory.errorTitle'])}</p>
            {retryIMCapability && (
              <Button variant="secondary" onClick={retryIMCapability}>
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
          loading={removal.isPending}
          disabled={!capabilityReady}
          aria-labelledby={removeLabelId}
          onClick={handleRemove}
        >
          <span id={removeLabelId}>
            {removal.isPending
              ? t(($) => $['memberRemoval.removing'])
              : t(($) => $['memberRemoval.remove'])}
          </span>
        </AlertDialogConfirmButton>
      </AlertDialogFooter>
    </>
  )
}
