'use client'

import { AlertDialog, AlertDialogContent } from '@langgenius/dify-ui/alert-dialog'
import { Button } from '@langgenius/dify-ui/button'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useAtomValue } from 'jotai'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from '@/app/notifications'
import { useRouter } from '@/next/navigation'
import { consoleQuery } from '@/service/console'
import { DeleteKnowledgeForm } from '../components/delete-knowledge-form'
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
  const [open, setOpen] = useState(false)
  const confirmationRef = useRef<HTMLInputElement>(null)
  const mutation = useMutation(
    consoleQuery.knowledgeFs.spaces.byControlSpaceId.delete.mutationOptions(),
  )

  if (!space) return null
  const canDelete = space.permission_keys.includes('knowledge_space_delete')
  if (!canDelete) return null
  const name = space.technical_summary?.name ?? ''

  const deleteKnowledge = async () => {
    if (mutation.isPending) return
    try {
      await mutation.mutateAsync({
        params: { control_space_id: space.control_space_id },
      })
      setOpen(false)
      void queryClient.invalidateQueries({
        queryKey: consoleQuery.knowledgeFs.spaces.get.key(),
      })
      router.replace(newKnowledgeListPath)
    } catch {
      toast.error(tCommon(($) => $['api.actionFailed']))
    }
  }

  return (
    <>
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
          <Button
            type="button"
            tone="destructive"
            disabled={hasPendingSave}
            onClick={() => setOpen(true)}
          >
            {tCommon(($) => $['operation.delete'])}
          </Button>
        </div>
      </div>

      <AlertDialog
        open={open}
        onOpenChange={(nextOpen) => {
          // The pending deletion redirects when it settles; keep it modal until then.
          if (!nextOpen && mutation.isPending) return
          setOpen(nextOpen)
        }}
      >
        <AlertDialogContent initialFocus={confirmationRef}>
          <DeleteKnowledgeForm
            confirmationRef={confirmationRef}
            knowledgeName={name}
            isPending={mutation.isPending}
            onSubmit={() => void deleteKnowledge()}
          />
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
