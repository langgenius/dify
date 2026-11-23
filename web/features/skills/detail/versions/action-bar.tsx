'use client'

import type { SkillVersionResponse } from '@dify/contracts/api/console/workspaces/types.gen'
import type { AlertDialogActions } from '@langgenius/dify-ui/alert-dialog'
import { AlertDialog, AlertDialogTrigger } from '@langgenius/dify-ui/alert-dialog'
import { Button } from '@langgenius/dify-ui/button'
import { useMutation } from '@tanstack/react-query'
import { useRef } from 'react'
import { useTranslation } from 'react-i18next'
import useTimestamp from '@/hooks/use-timestamp'
import { consoleQuery } from '@/service/console'
import { RestoreVersionDialogContent } from './restore-dialog'
import { getSkillVersionTitle } from './title'

export function SkillVersionActionBar({
  onExit,
  onRestored,
  version,
}: {
  onExit: () => void
  onRestored: () => void
  version: SkillVersionResponse
}) {
  const actionsRef = useRef<AlertDialogActions>(null)
  const restoreMutation = useMutation(
    consoleQuery.workspaces.current.skills.bySkillId.restore.post.mutationOptions({
      onSuccess: () => {
        actionsRef.current?.close()
        onRestored()
      },
    }),
  )
  const { t } = useTranslation(['skill'])
  const { formatTime } = useTimestamp()
  const publishedBy = version.published_by_name ?? version.published_by ?? '-'
  const publishedAt = formatTime(
    version.created_at,
    t(($) => $['skillManagement.dateTimeFormat']),
  )

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-3 flex justify-center px-4">
      <div className="pointer-events-auto flex h-14 w-107 max-w-[calc(100%-2rem)] items-center gap-4 rounded-xl border border-divider-subtle bg-background-default px-4 shadow-xl">
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-1.5">
            <span className="truncate system-sm-semibold text-text-primary">
              {getSkillVersionTitle(version)}
            </span>
            <span className="border-state-accent-border shrink-0 rounded-[5px] border bg-state-accent-hover px-1.5 py-0.5 system-2xs-semibold-uppercase text-text-accent">
              {t(($) => $['skillManagement.detail.viewOnly'])}
            </span>
          </div>
          <div className="mt-0.5 truncate system-xs-regular text-text-tertiary">
            {t(($) => $['skillManagement.detail.versionPublishedMeta'], {
              name: publishedBy,
              time: publishedAt,
            })}
          </div>
        </div>
        <AlertDialog
          actionsRef={actionsRef}
          onOpenChange={(_open, details) => {
            if (restoreMutation.isPending && details.reason !== 'imperative-action')
              details.cancel()
          }}
        >
          <AlertDialogTrigger
            render={
              <Button variant="primary" className="h-9 px-5" loading={restoreMutation.isPending} />
            }
          >
            {t(($) => $['skillManagement.detail.restoreVersion'])}
          </AlertDialogTrigger>
          <RestoreVersionDialogContent
            versionTitle={getSkillVersionTitle(version)}
            isPending={restoreMutation.isPending}
            onConfirm={() =>
              restoreMutation.mutate({
                params: { skill_id: version.skill_id },
                body: { version_id: version.id, version_name: version.version_name },
              })
            }
          />
        </AlertDialog>
        <Button variant="secondary" className="h-9 px-4" onClick={onExit}>
          <span aria-hidden className="i-ri-history-line size-4" />
          {t(($) => $['skillManagement.detail.exitVersions'])}
        </Button>
      </div>
    </div>
  )
}
