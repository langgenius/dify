'use client'

import {
  AlertDialog,
  AlertDialogActions,
  AlertDialogCancelButton,
  AlertDialogConfirmButton,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from '@langgenius/dify-ui/alert-dialog'
import { Button } from '@langgenius/dify-ui/button'
import { Input } from '@langgenius/dify-ui/input'
import { toast } from '@langgenius/dify-ui/toast'
import { useMutation } from '@tanstack/react-query'
import { useAtomValue } from 'jotai'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useRouter } from '@/next/navigation'
import { consoleQuery } from '@/service/client'
import { newKnowledgeListPath } from '../routes'
import { knowledgeSettingsSpaceAtom } from './state/queries'
import { knowledgeSettingsHasPendingSaveAtom } from './state/workflow'

export function DeleteKnowledgeAction() {
  const { t } = useTranslation('knowledgeSpace')
  const { t: tCommon } = useTranslation('common')
  const router = useRouter()
  const space = useAtomValue(knowledgeSettingsSpaceAtom)
  const hasPendingSave = useAtomValue(knowledgeSettingsHasPendingSaveAtom)
  const [open, setOpen] = useState(false)
  const [confirmation, setConfirmation] = useState('')
  const cancelRef = useRef<HTMLButtonElement>(null)
  const mutation = useMutation(
    consoleQuery.knowledgeFs.spaces.byControlSpaceId.delete.mutationOptions(),
  )

  if (!space) return null
  const canEdit = space.permission_keys.includes('knowledge_space_edit')
  const canDelete = space.permission_keys.includes('knowledge_space_delete')
  if (!canEdit || !canDelete) return null
  const name = space.technical_summary?.name ?? ''

  const deleteKnowledge = async () => {
    if (confirmation !== name || mutation.isPending) return
    try {
      await mutation.mutateAsync({
        params: { control_space_id: space.control_space_id },
      })
      setOpen(false)
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
          {t(($) => $['settings.dangerZone'])}
        </h2>
        <div className="flex min-w-0 flex-1 items-center justify-between gap-4 rounded-xl border border-components-button-destructive-secondary-border px-4 py-3">
          <div className="min-w-0">
            <p className="system-sm-medium text-text-secondary">
              {t(($) => $['settings.deleteTitle'])}
            </p>
            <p className="mt-0.5 body-xs-regular text-text-tertiary">
              {t(($) => $['settings.deleteDescription'])}
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
          setOpen(nextOpen)
          if (!nextOpen) setConfirmation('')
        }}
      >
        <AlertDialogContent initialFocus={cancelRef}>
          <div className="px-6 pt-6">
            <AlertDialogTitle className="title-xl-semi-bold text-text-primary">
              {t(($) => $['settings.deleteDialogTitle'], { name })}
            </AlertDialogTitle>
            <AlertDialogDescription className="mt-2 body-sm-regular text-text-tertiary">
              {t(($) => $['settings.deleteDialogDescription'])}
            </AlertDialogDescription>
            <label
              htmlFor="knowledge-delete-confirmation"
              className="mt-5 block system-sm-medium text-text-secondary"
            >
              {t(($) => $['settings.deleteConfirmPrompt'], { name })}
            </label>
            <Input
              id="knowledge-delete-confirmation"
              autoComplete="off"
              name="knowledge-delete-confirmation"
              placeholder={name}
              value={confirmation}
              className="mt-2 w-full"
              onChange={(event) => setConfirmation(event.target.value)}
            />
          </div>
          <AlertDialogActions>
            <AlertDialogCancelButton ref={cancelRef}>
              {tCommon(($) => $['operation.cancel'])}
            </AlertDialogCancelButton>
            <AlertDialogConfirmButton
              disabled={confirmation !== name || mutation.isPending}
              loading={mutation.isPending}
              onClick={() => void deleteKnowledge()}
            >
              {tCommon(($) => $['operation.delete'])}
            </AlertDialogConfirmButton>
          </AlertDialogActions>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
