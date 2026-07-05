'use client'

import type { SnippetDetail } from '@/models/snippet'
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
import { toast } from '@langgenius/dify-ui/toast'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import CreateSnippetDialog from '@/app/components/snippets/create-snippet-dialog'
import { canCreateAndModifySnippets, canManageSnippets } from '@/app/components/snippets/utils/permission'
import { useSelector as useAppContextWithSelector } from '@/context/app-context'
import { useRouter } from '@/next/navigation'
import { useDeleteSnippetMutation, useExportSnippetMutation, useUpdateSnippetMutation } from '@/service/use-snippets'

import { downloadBlob } from '@/utils/download'

type SnippetInfoDropdownProps = {
  snippet: SnippetDetail
}

const SnippetInfoDropdown = ({ snippet }: SnippetInfoDropdownProps) => {
  const { t } = useTranslation('snippet')
  const { replace } = useRouter()
  const workspacePermissionKeys = useAppContextWithSelector(state => state.workspacePermissionKeys)
  const [open, setOpen] = React.useState(false)
  const [isEditDialogOpen, setIsEditDialogOpen] = React.useState(false)
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = React.useState(false)
  const updateSnippetMutation = useUpdateSnippetMutation()
  const exportSnippetMutation = useExportSnippetMutation()
  const deleteSnippetMutation = useDeleteSnippetMutation()
  const canCreateAndModifySnippet = canCreateAndModifySnippets(workspacePermissionKeys)
  const canManageSnippet = canManageSnippets(workspacePermissionKeys)
  const canShowOperations = canCreateAndModifySnippet || canManageSnippet

  const initialValue = React.useMemo(() => ({
    name: snippet.name,
    description: snippet.description ?? undefined,
  }), [snippet.description, snippet.name])

  const handleOpenEditDialog = React.useCallback(() => {
    setOpen(false)
    setIsEditDialogOpen(true)
  }, [])

  const handleExportSnippet = React.useCallback(async () => {
    if (!canCreateAndModifySnippet)
      return

    setOpen(false)
    try {
      const data = await exportSnippetMutation.mutateAsync({ snippetId: snippet.id })
      const file = new Blob([data], { type: 'application/yaml' })
      downloadBlob({ data: file, fileName: `${snippet.name}.yml` })
    }
    catch {
      toast.error(t('exportFailed'))
    }
  }, [canCreateAndModifySnippet, exportSnippetMutation, snippet.id, snippet.name, t])

  const handleEditSnippet = React.useCallback(async ({ name, description }: {
    name: string
    description: string
  }) => {
    updateSnippetMutation.mutate({
      params: { snippetId: snippet.id },
      body: {
        name,
        description,
      },
    }, {
      onSuccess: () => {
        toast.success(t('editDone'))
        setIsEditDialogOpen(false)
      },
      onError: (error) => {
        toast.error(error instanceof Error ? error.message : t('editFailed'))
      },
    })
  }, [snippet.id, t, updateSnippetMutation])

  const handleDeleteSnippet = React.useCallback(() => {
    deleteSnippetMutation.mutate({
      params: { snippetId: snippet.id },
    }, {
      onSuccess: () => {
        toast.success(t('deleted'))
        setIsDeleteDialogOpen(false)
        replace('/snippets')
      },
      onError: (error) => {
        toast.error(error instanceof Error ? error.message : t('deleteFailed'))
      },
    })
  }, [deleteSnippetMutation, replace, snippet.id, t])

  if (!canShowOperations)
    return null

  return (
    <>
      <DropdownMenu open={open} onOpenChange={setOpen}>
        <DropdownMenuTrigger
          className={cn('action-btn action-btn-m size-6 rounded-md text-text-tertiary', open && 'bg-state-base-hover text-text-secondary')}
        >
          <span aria-hidden className="i-ri-more-fill size-4" />
        </DropdownMenuTrigger>
        <DropdownMenuContent
          placement="bottom-end"
          sideOffset={4}
          popupClassName="w-[180px] p-1"
        >
          {canCreateAndModifySnippet && (
            <>
              <DropdownMenuItem className="mx-0 gap-2" onClick={handleOpenEditDialog}>
                <span aria-hidden className="i-ri-edit-line size-4 shrink-0 text-text-tertiary" />
                <span className="grow">{t('menu.editInfo')}</span>
              </DropdownMenuItem>
              <DropdownMenuItem className="mx-0 gap-2" onClick={handleExportSnippet}>
                <span aria-hidden className="i-ri-download-2-line size-4 shrink-0 text-text-tertiary" />
                <span className="grow">{t('menu.exportSnippet')}</span>
              </DropdownMenuItem>
            </>
          )}
          {canManageSnippet && (
            <>
              {canCreateAndModifySnippet && <DropdownMenuSeparator className="my-1! bg-divider-subtle" />}
              <DropdownMenuItem
                className="mx-0 gap-2"
                variant="destructive"
                onClick={() => {
                  setOpen(false)
                  setIsDeleteDialogOpen(true)
                }}
              >
                <span aria-hidden className="i-ri-delete-bin-line size-4 shrink-0" />
                <span className="grow">{t('menu.deleteSnippet')}</span>
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {isEditDialogOpen && (
        <CreateSnippetDialog
          isOpen={isEditDialogOpen}
          initialValue={initialValue}
          title={t('editDialogTitle')}
          confirmText={t('operation.save', { ns: 'common' })}
          isSubmitting={updateSnippetMutation.isPending}
          onClose={() => setIsEditDialogOpen(false)}
          onConfirm={handleEditSnippet}
        />
      )}

      <AlertDialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
        <AlertDialogContent className="w-100">
          <div className="space-y-2 p-6">
            <AlertDialogTitle className="title-md-semi-bold text-text-primary">
              {t('deleteConfirmTitle')}
            </AlertDialogTitle>
            <AlertDialogDescription className="system-sm-regular text-text-tertiary">
              {t('deleteConfirmContent')}
            </AlertDialogDescription>
          </div>
          <AlertDialogActions className="pt-0">
            <AlertDialogCancelButton>
              {t('operation.cancel', { ns: 'common' })}
            </AlertDialogCancelButton>
            <AlertDialogConfirmButton
              loading={deleteSnippetMutation.isPending}
              onClick={handleDeleteSnippet}
            >
              {t('menu.deleteSnippet')}
            </AlertDialogConfirmButton>
          </AlertDialogActions>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

export default React.memo(SnippetInfoDropdown)
