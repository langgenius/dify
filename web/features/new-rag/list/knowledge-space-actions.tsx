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
import { IconButton } from '@langgenius/dify-ui/icon-button'
import { Input } from '@langgenius/dify-ui/input'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from '@/app/notifications'
import { useRouter } from '@/next/navigation'
import { consoleQuery } from '@/service/console'
import { newKnowledgeSettingsPath } from '../routes'

export function KnowledgeSpaceActions({
  knowledgeSpace,
}: {
  knowledgeSpace: KnowledgeFsSpaceListItemResponse
}) {
  const { t } = useTranslation('knowledgeSpace')
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
      toast.success(t(($) => $.deleteSuccess))
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
          'pointer-events-none absolute top-0 right-0 z-5 flex h-16 w-30 items-start justify-end bg-linear-65 from-components-card-bg-alt-transparent to-components-card-bg-alt to-75% p-2',
          menuOpen ? 'visible' : 'invisible group-focus-within:visible group-hover:visible',
        )}
      >
        <div className="pointer-events-auto flex items-center overflow-hidden rounded-[10px] border-[0.5px] border-components-actionbar-border bg-components-actionbar-bg p-0.5 shadow-lg backdrop-blur-xs">
          <DropdownMenu modal={false} open={menuOpen} onOpenChange={setMenuOpen}>
            <DropdownMenuTrigger
              render={
                <IconButton
                  aria-label={tCommon(($) => $['operation.more'])}
                  size="lg"
                  className="focus-visible:bg-state-base-hover data-popup-open:bg-state-base-hover"
                >
                  <span aria-hidden className="i-ri-more-fill size-4.5" />
                </IconButton>
              }
            />
            <DropdownMenuContent placement="bottom-end" sideOffset={4} className="min-w-46.5">
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
              {t(($) => $['settings.deleteDialogTitle'], { name })}
            </AlertDialogTitle>
            <AlertDialogDescription className="mt-2 body-sm-regular text-text-tertiary">
              {t(($) => $['settings.deleteDialogDescription'])}
            </AlertDialogDescription>
            <label
              htmlFor={`knowledge-delete-confirmation-${knowledgeSpace.control_space_id}`}
              className="mt-5 block system-sm-medium text-text-secondary"
            >
              {t(($) => $['settings.deleteConfirmPrompt'], { name })}
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
              disabled={deleteConfirmation !== name}
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
