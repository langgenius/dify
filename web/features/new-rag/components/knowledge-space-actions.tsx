'use client'

import type { KnowledgeFsSpaceListItemResponse } from '@dify/contracts/api/console/knowledge-fs/types.gen'
import {
  AlertDialog,
  AlertDialogActions,
  AlertDialogCancelButton,
  AlertDialogConfirmButton,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from '@langgenius/dify-ui/alert-dialog'
import { cn } from '@langgenius/dify-ui/cn'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@langgenius/dify-ui/dropdown-menu'
import { Input } from '@langgenius/dify-ui/input'
import { toast } from '@langgenius/dify-ui/toast'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useRouter } from '@/next/navigation'
import { consoleQuery } from '@/service/client'
import { newKnowledgeSettingsPath } from '../routes'

export function KnowledgeSpaceActions({
  knowledgeSpace,
}: {
  knowledgeSpace: KnowledgeFsSpaceListItemResponse
}) {
  const { t } = useTranslation('dataset')
  const { t: tCommon } = useTranslation('common')
  const router = useRouter()
  const queryClient = useQueryClient()
  const [menuOpen, setMenuOpen] = useState(false)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [deleteConfirmation, setDeleteConfirmation] = useState('')
  const deleteCancelRef = useRef<HTMLButtonElement>(null)
  const canEdit = knowledgeSpace.permission_keys.includes('knowledge_space_edit')
  const canDelete = knowledgeSpace.permission_keys.includes('knowledge_space_delete')
  const name = knowledgeSpace.technical_summary?.name ?? knowledgeSpace.control_space_id

  const deleteMutation = useMutation({
    ...consoleQuery.knowledgeFs.spaces.byControlSpaceId.delete.mutationOptions(),
    onError: () => toast.error(tCommon(($) => $['api.actionFailed'])),
    onSuccess: () => {
      setDeleteDialogOpen(false)
      setDeleteConfirmation('')
      toast.success(t(($) => $.datasetDeleted))
      void queryClient.invalidateQueries({
        queryKey: consoleQuery.knowledgeFs.spaces.get.key(),
      })
    },
  })

  if (!canEdit && !canDelete) return null

  const openSettings = () => {
    setMenuOpen(false)
    router.push(newKnowledgeSettingsPath(knowledgeSpace.control_space_id))
  }

  const openDeleteDialog = () => {
    setMenuOpen(false)
    setDeleteDialogOpen(true)
  }

  const deleteKnowledge = () => {
    if (deleteConfirmation !== name || deleteMutation.isPending) return
    deleteMutation.mutate({
      params: { control_space_id: knowledgeSpace.control_space_id },
    })
  }

  return (
    <>
      <div
        className={cn(
          'absolute top-2 right-2 z-5',
          menuOpen
            ? 'pointer-events-auto visible'
            : 'pointer-events-none invisible group-focus-within:pointer-events-auto group-focus-within:visible group-hover:pointer-events-auto group-hover:visible',
        )}
      >
        <DropdownMenu modal={false} open={menuOpen} onOpenChange={setMenuOpen}>
          <DropdownMenuTrigger
            aria-label={tCommon(($) => $['operation.more'])}
            className={cn(
              'inline-flex size-9 cursor-pointer items-center justify-center rounded-[10px] border-[0.5px]',
              'border-components-actionbar-border bg-components-button-secondary-bg p-0 shadow-lg inset-ring-2 shadow-shadow-shadow-5 inset-ring-components-button-secondary-bg',
              'transition-colors hover:border-components-actionbar-border hover:bg-state-base-hover',
              'focus-visible:bg-state-base-hover focus-visible:inset-ring-1 focus-visible:inset-ring-components-input-border-hover focus-visible:outline-hidden',
              'data-popup-open:bg-state-base-hover',
            )}
          >
            <span aria-hidden className="i-ri-more-fill size-5 text-text-tertiary" />
          </DropdownMenuTrigger>
          <DropdownMenuContent placement="bottom-end" sideOffset={4} className="min-w-[186px]">
            {canEdit && (
              <DropdownMenuItem onClick={openSettings}>
                <span aria-hidden className="mr-1 i-ri-edit-line size-4 text-text-tertiary" />
                {tCommon(($) => $['operation.edit'])}
              </DropdownMenuItem>
            )}
            {canDelete && (
              <>
                {canEdit && <DropdownMenuSeparator />}
                <DropdownMenuItem variant="destructive" onClick={openDeleteDialog}>
                  <span aria-hidden className="mr-1 i-ri-delete-bin-line size-4" />
                  {tCommon(($) => $['operation.delete'])}
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <AlertDialog
        open={deleteDialogOpen}
        onOpenChange={(open) => {
          setDeleteDialogOpen(open)
          if (!open) setDeleteConfirmation('')
        }}
      >
        <AlertDialogContent initialFocus={deleteCancelRef}>
          <div className="px-6 pt-6">
            <AlertDialogTitle className="title-xl-semi-bold text-text-primary">
              {t(($) => $['newKnowledge.settings.deleteDialogTitle'], { name })}
            </AlertDialogTitle>
            <AlertDialogDescription className="mt-2 body-sm-regular text-text-tertiary">
              {t(($) => $['newKnowledge.settings.deleteDialogDescription'])}
            </AlertDialogDescription>
            <label
              htmlFor={`knowledge-delete-confirmation-${knowledgeSpace.control_space_id}`}
              className="mt-5 block system-sm-medium text-text-secondary"
            >
              {t(($) => $['newKnowledge.settings.deleteConfirmPrompt'], { name })}
            </label>
            <Input
              id={`knowledge-delete-confirmation-${knowledgeSpace.control_space_id}`}
              autoComplete="off"
              name="knowledge-delete-confirmation"
              value={deleteConfirmation}
              className="mt-2 w-full"
              onChange={(event) => setDeleteConfirmation(event.target.value)}
            />
          </div>
          <AlertDialogActions>
            <AlertDialogCancelButton ref={deleteCancelRef}>
              {tCommon(($) => $['operation.cancel'])}
            </AlertDialogCancelButton>
            <AlertDialogConfirmButton
              disabled={deleteConfirmation !== name || deleteMutation.isPending}
              loading={deleteMutation.isPending}
              onClick={deleteKnowledge}
            >
              {tCommon(($) => $['operation.delete'])}
            </AlertDialogConfirmButton>
          </AlertDialogActions>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
