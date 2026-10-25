'use client'

import type { SnippetDetail } from '@/models/snippet'
import {
  AlertDialog,
  AlertDialogCancelButton,
  AlertDialogConfirmButton,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@langgenius/dify-ui/alert-dialog'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from '@langgenius/dify-ui/menu'
import { useAtomValue } from 'jotai'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { CreateSnippetDialog } from '@/app/components/snippets/create-snippet-dialog'
import {
  canCreateAndModifySnippets,
  canManageSnippets,
} from '@/app/components/snippets/utils/permission'
import { toast } from '@/app/notifications'
import { workspacePermissionKeysAtom } from '@/context/permission-state'
import { useRouter } from '@/next/navigation'
import {
  useDeleteSnippetMutation,
  useExportSnippetMutation,
  useUpdateSnippetMutation,
} from '@/service/use-snippets'
import { downloadBlob } from '@/utils/download'

type SnippetInfoMenuProps = {
  snippet: SnippetDetail
}

const SnippetInfoMenu = ({ snippet }: SnippetInfoMenuProps) => {
  const { t } = useTranslation(['snippet', 'common'])
  const { replace } = useRouter()
  const workspacePermissionKeys = useAtomValue(workspacePermissionKeysAtom)
  const [isEditDialogOpen, setIsEditDialogOpen] = React.useState(false)
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = React.useState(false)
  const updateSnippetMutation = useUpdateSnippetMutation()
  const exportSnippetMutation = useExportSnippetMutation()
  const deleteSnippetMutation = useDeleteSnippetMutation()
  const canCreateAndModifySnippet = canCreateAndModifySnippets(workspacePermissionKeys)
  const canManageSnippet = canManageSnippets(workspacePermissionKeys)
  const canShowOperations = canCreateAndModifySnippet || canManageSnippet

  const initialValue = React.useMemo(
    () => ({
      name: snippet.name,
      description: snippet.description ?? undefined,
    }),
    [snippet.description, snippet.name],
  )

  const handleOpenEditDialog = React.useCallback(() => {
    setIsEditDialogOpen(true)
  }, [])

  const handleExportSnippet = React.useCallback(async () => {
    if (!canCreateAndModifySnippet) return

    try {
      const data = await exportSnippetMutation.mutateAsync({ snippetId: snippet.id })
      const file = new Blob([data], { type: 'application/yaml' })
      downloadBlob({ data: file, fileName: `${snippet.name}.yml` })
    } catch {
      toast.error(t(($) => $.exportFailed))
    }
  }, [canCreateAndModifySnippet, exportSnippetMutation, snippet.id, snippet.name, t])

  const handleEditSnippet = React.useCallback(
    async ({ name, description }: { name: string; description: string }) => {
      updateSnippetMutation.mutate(
        {
          params: { snippetId: snippet.id },
          body: {
            name,
            description,
          },
        },
        {
          onSuccess: () => {
            setIsEditDialogOpen(false)
          },
          onError: (error) => {
            toast.error(error instanceof Error ? error.message : t(($) => $.editFailed))
          },
        },
      )
    },
    [snippet.id, t, updateSnippetMutation],
  )

  const handleDeleteSnippet = React.useCallback(() => {
    deleteSnippetMutation.mutate(
      {
        params: { snippetId: snippet.id },
      },
      {
        onSuccess: () => {
          toast.success(t(($) => $.deleted))
          setIsDeleteDialogOpen(false)
          replace('/snippets')
        },
        onError: (error) => {
          toast.error(error instanceof Error ? error.message : t(($) => $.deleteFailed))
        },
      },
    )
  }, [deleteSnippetMutation, replace, snippet.id, t])

  if (!canShowOperations) return null

  return (
    <>
      <Menu>
        <MenuTrigger
          render={
            <IconButton
              aria-label={t(($) => $['operation.more'], { ns: 'common' })}
              className="data-popup-open:bg-state-base-hover data-popup-open:text-text-secondary"
            >
              <span aria-hidden className="i-ri-more-fill size-4" />
            </IconButton>
          }
        />
        <MenuContent align="end" className="w-45">
          {canCreateAndModifySnippet && (
            <>
              <MenuItem className="gap-2" onClick={handleOpenEditDialog}>
                <span aria-hidden className="i-ri-edit-line size-4 shrink-0 text-text-tertiary" />
                <span className="grow">{t(($) => $['menu.editInfo'])}</span>
              </MenuItem>
              <MenuItem className="gap-2" onClick={handleExportSnippet}>
                <span
                  aria-hidden
                  className="i-ri-download-2-line size-4 shrink-0 text-text-tertiary"
                />
                <span className="grow">{t(($) => $['menu.exportSnippet'])}</span>
              </MenuItem>
            </>
          )}
          {canManageSnippet && (
            <>
              {canCreateAndModifySnippet && <MenuSeparator className="my-1! bg-divider-subtle" />}
              <MenuItem
                className="gap-2"
                variant="destructive"
                onClick={() => setIsDeleteDialogOpen(true)}
              >
                <span aria-hidden className="i-ri-delete-bin-line size-4 shrink-0" />
                <span className="grow">{t(($) => $['menu.deleteSnippet'])}</span>
              </MenuItem>
            </>
          )}
        </MenuContent>
      </Menu>

      {isEditDialogOpen && (
        <CreateSnippetDialog
          isOpen={isEditDialogOpen}
          initialValue={initialValue}
          title={t(($) => $.editDialogTitle)}
          confirmText={t(($) => $['operation.save'], { ns: 'common' })}
          isSubmitting={updateSnippetMutation.isPending}
          onClose={() => setIsEditDialogOpen(false)}
          onConfirm={handleEditSnippet}
        />
      )}

      <AlertDialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t(($) => $.deleteConfirmTitle)}</AlertDialogTitle>
            <AlertDialogDescription>{t(($) => $.deleteConfirmContent)}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancelButton>
              {t(($) => $['operation.cancel'], { ns: 'common' })}
            </AlertDialogCancelButton>
            <AlertDialogConfirmButton
              loading={deleteSnippetMutation.isPending}
              onClick={handleDeleteSnippet}
            >
              {t(($) => $['menu.deleteSnippet'])}
            </AlertDialogConfirmButton>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

export default React.memo(SnippetInfoMenu)
