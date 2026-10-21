'use client'

import type { KnowledgeFsSpaceListItemResponse } from '@dify/contracts/api/console/knowledge-fs/types.gen'
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLinkItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@langgenius/dify-ui/dropdown-menu'
import { Field, FieldLabel } from '@langgenius/dify-ui/field'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import { Input } from '@langgenius/dify-ui/input'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import Link from '@/next/link'
import { consoleQuery } from '@/service/console'
import { getHttpErrorStatus } from '@/service/http-error'
import { newKnowledgeSettingsPath } from '../routes'

export function KnowledgeSpaceActions({
  knowledgeSpace,
}: {
  knowledgeSpace: KnowledgeFsSpaceListItemResponse
}) {
  const { t } = useTranslation(['knowledgeSpace', 'knowledgeSettings'])
  const { t: tCommon } = useTranslation(['common'])
  const queryClient = useQueryClient()
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [deleteConfirmation, setDeleteConfirmation] = useState('')
  const canEdit = knowledgeSpace.permission_keys.includes('knowledge_space_edit')
  const canDelete = knowledgeSpace.permission_keys.includes('knowledge_space_delete')
  const name = knowledgeSpace.technical_summary?.name ?? knowledgeSpace.control_space_id

  const deleteMutation = useMutation({
    // The dialog shows the failure next to the confirmation the user can retry.
    ...consoleQuery.knowledgeFs.spaces.byControlSpaceId.delete.mutationOptions({
      context: { silent: true },
    }),
    onSuccess: () => {
      // The card leaves the list once it refreshes; that removal is the success feedback.
      setDeleteDialogOpen(false)
      setDeleteConfirmation('')
      void queryClient.invalidateQueries({
        queryKey: consoleQuery.knowledgeFs.spaces.get.key(),
      })
    },
  })

  if (!canEdit && !canDelete) return null

  const deleteError = deleteMutation.error
    ? getHttpErrorStatus(deleteMutation.error) !== undefined
      ? deleteMutation.error.message
      : tCommon(($) => $['api.actionFailed'])
    : undefined

  return (
    <>
      <div className="pointer-events-none absolute top-0 right-0 z-5 flex h-16 w-30 items-start justify-end bg-linear-65 from-components-card-bg-alt-transparent to-components-card-bg-alt to-75% p-2 opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 has-data-popup-open:opacity-100 [@media(hover:none)]:opacity-100">
        <div className="pointer-events-auto flex items-center overflow-hidden rounded-[10px] border-[0.5px] border-components-actionbar-border bg-components-actionbar-bg p-0.5 shadow-lg backdrop-blur-xs">
          <DropdownMenu modal={false}>
            <DropdownMenuTrigger
              render={
                <IconButton
                  aria-label={tCommon(($) => $['operation.more'])}
                  size="lg"
                  className="data-popup-open:bg-state-base-hover"
                >
                  <span aria-hidden className="i-ri-more-fill size-4.5" />
                </IconButton>
              }
            />
            <DropdownMenuContent placement="bottom-end" sideOffset={4} className="min-w-46.5">
              {canEdit && (
                <DropdownMenuLinkItem
                  render={<Link href={newKnowledgeSettingsPath(knowledgeSpace.control_space_id)} />}
                >
                  <span aria-hidden className="mr-1 i-ri-edit-line size-4 text-text-tertiary" />
                  {tCommon(($) => $['operation.edit'])}
                </DropdownMenuLinkItem>
              )}
              {canDelete && (
                <>
                  {canEdit && <DropdownMenuSeparator />}
                  <DropdownMenuItem variant="destructive" onClick={() => setDeleteDialogOpen(true)}>
                    <span aria-hidden className="mr-1 i-ri-delete-bin-line size-4" />
                    {tCommon(($) => $['operation.delete'])}
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <AlertDialog
        open={deleteDialogOpen}
        onOpenChange={(open) => {
          if (deleteMutation.isPending) return
          setDeleteDialogOpen(open)
          if (!open) {
            setDeleteConfirmation('')
            deleteMutation.reset()
          }
        }}
      >
        <AlertDialogContent>
          <form
            className="contents"
            onSubmit={(event) => {
              event.preventDefault()
              if (deleteConfirmation !== name || deleteMutation.isPending) return
              deleteMutation.mutate({
                params: { control_space_id: knowledgeSpace.control_space_id },
              })
            }}
          >
            <AlertDialogHeader>
              <AlertDialogTitle>
                {t(($) => $['settings.deleteDialogTitle'], { ns: 'knowledgeSettings', name })}
              </AlertDialogTitle>
              <AlertDialogDescription>
                {t(($) => $['settings.deleteDialogDescription'], { ns: 'knowledgeSettings' })}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogBody>
              <Field name="knowledge-delete-confirmation">
                <FieldLabel>
                  {t(($) => $['settings.deleteConfirmPrompt'], { ns: 'knowledgeSettings', name })}
                </FieldLabel>
                <Input
                  autoComplete="off"
                  value={deleteConfirmation}
                  onChange={(event) => setDeleteConfirmation(event.target.value)}
                />
              </Field>
              {deleteError && (
                <p role="alert" className="mt-2 system-xs-regular text-text-destructive">
                  {deleteError}
                </p>
              )}
            </AlertDialogBody>
            <AlertDialogFooter>
              <AlertDialogCancelButton disabled={deleteMutation.isPending}>
                {tCommon(($) => $['operation.cancel'])}
              </AlertDialogCancelButton>
              <AlertDialogConfirmButton
                type="submit"
                disabled={deleteConfirmation !== name}
                loading={deleteMutation.isPending}
              >
                {tCommon(($) => $['operation.delete'])}
              </AlertDialogConfirmButton>
            </AlertDialogFooter>
          </form>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
