'use client'

import type { AlertDialogActions } from '@langgenius/dify-ui/alert-dialog'
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogTrigger,
} from '@langgenius/dify-ui/alert-dialog'
import { Button } from '@langgenius/dify-ui/button'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useAtomValue } from 'jotai'
import { useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { useRouter } from '@/next/navigation'
import { consoleQuery } from '@/service/console'
import { DeleteKnowledgeForm } from '../delete-knowledge-form'
import { newKnowledgeListPath } from '../routes'
import { knowledgeSettingsSpaceAtom } from './state/queries'
import { knowledgeSettingsHasPendingSaveAtom } from './state/workflow'

export function DeleteKnowledgeAction() {
  const { t } = useTranslation(['knowledgeSettings'])
  const { t: tCommon } = useTranslation(['common'])
  const router = useRouter()
  const queryClient = useQueryClient()
  const space = useAtomValue(knowledgeSettingsSpaceAtom)
  const hasPendingSave = useAtomValue(knowledgeSettingsHasPendingSaveAtom)
  const deleteActionsRef = useRef<AlertDialogActions>(null)
  const mutation = useMutation(
    consoleQuery.knowledgeFs.spaces.byControlSpaceId.delete.mutationOptions({
      context: { silent: true },
    }),
  )

  if (!space) return null
  const canDelete = space.permission_keys.includes('knowledge_space_delete')
  if (!canDelete) return null
  const name = space.technical_summary?.name ?? ''

  const deleteKnowledge = () => {
    if (mutation.isPending) return
    mutation.mutate(
      { params: { control_space_id: space.control_space_id } },
      {
        onSuccess: () => {
          deleteActionsRef.current?.close()
          void queryClient.invalidateQueries({
            queryKey: consoleQuery.knowledgeFs.spaces.get.key(),
          })
          router.replace(newKnowledgeListPath)
        },
      },
    )
  }

  return (
    <AlertDialog
      actionsRef={deleteActionsRef}
      onOpenChange={(nextOpen, details) => {
        if (!nextOpen && mutation.isPending && details.reason !== 'imperative-action')
          details.cancel()
      }}
      onOpenChangeComplete={(open) => {
        if (!open) mutation.reset()
      }}
    >
      <div className="h-px bg-divider-subtle" />
      <div className="flex min-w-0 flex-col gap-4 pt-7 sm:flex-row sm:gap-1">
        <h2 className="flex h-8 w-full shrink-0 items-center system-sm-semibold text-text-destructive sm:w-45">
          {t(($) => $['settings.dangerZone'], { ns: 'knowledgeSettings' })}
        </h2>
        <div className="flex min-w-0 flex-1 items-center justify-between gap-4 rounded-xl border border-components-button-destructive-secondary-border px-4 py-3">
          <div className="min-w-0">
            <p className="system-sm-medium text-text-secondary">
              {t(($) => $['settings.deleteTitle'], { ns: 'knowledgeSettings' })}
            </p>
            <p className="mt-0.5 body-xs-regular text-text-tertiary">
              {t(($) => $['settings.deleteDescription'], { ns: 'knowledgeSettings' })}
            </p>
          </div>
          <AlertDialogTrigger
            render={<Button type="button" tone="destructive" disabled={hasPendingSave} />}
          >
            {tCommon(($) => $['operation.delete'])}
          </AlertDialogTrigger>
        </div>
      </div>

      <AlertDialogContent>
        <DeleteKnowledgeForm
          knowledgeName={name}
          isPending={mutation.isPending}
          error={mutation.isError ? tCommon(($) => $['api.actionFailed']) : undefined}
          onSubmit={deleteKnowledge}
        />
      </AlertDialogContent>
    </AlertDialog>
  )
}
