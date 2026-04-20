'use client'

import type { AppIconSelection } from '@/app/components/base/app-icon-picker'
import type { SnippetDetail } from '@/models/snippet'
import { cn } from '@langgenius/dify-ui/cn'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import {
  AlertDialog,
  AlertDialogActions,
  AlertDialogCancelButton,
  AlertDialogConfirmButton,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from '@/app/components/base/ui/alert-dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/app/components/base/ui/dropdown-menu'
import { toast } from '@/app/components/base/ui/toast'
import CreateSnippetDialog from '@/app/components/workflow/create-snippet-dialog'
import { useRouter } from '@/next/navigation'
import { useDeleteSnippetMutation, useExportSnippetMutation, useUpdateSnippetMutation } from '@/service/use-snippets'

import { downloadBlob } from '@/utils/download'

type SnippetInfoDropdownProps = {
  snippet: SnippetDetail
}

const FALLBACK_ICON: AppIconSelection = {
  type: 'emoji',
  icon: '🤖',
  background: '#FFEAD5',
}

const SnippetInfoDropdown = ({ snippet }: SnippetInfoDropdownProps) => {
  const { t } = useTranslation('snippet')
  const { replace } = useRouter()
  const [open, setOpen] = React.useState(false)
  const [isEditDialogOpen, setIsEditDialogOpen] = React.useState(false)
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = React.useState(false)
  const updateSnippetMutation = useUpdateSnippetMutation()
  const exportSnippetMutation = useExportSnippetMutation()
  const deleteSnippetMutation = useDeleteSnippetMutation()

  const initialValue = React.useMemo(() => ({
    name: snippet.name,
    description: snippet.description,
    icon: snippet.icon
      ? {
          type: 'emoji' as const,
          icon: snippet.icon,
          background: snippet.iconBackground || FALLBACK_ICON.background,
        }
      : FALLBACK_ICON,
  }), [snippet.description, snippet.icon, snippet.iconBackground, snippet.name])

  const handleOpenEditDialog = React.useCallback(() => {
    setOpen(false)
    setIsEditDialogOpen(true)
  }, [])

  const handleExportSnippet = React.useCallback(async () => {
    setOpen(false)
    try {
      const data = await exportSnippetMutation.mutateAsync({ snippetId: snippet.id })
      const file = new Blob([data], { type: 'application/yaml' })
      downloadBlob({ data: file, fileName: `${snippet.name}.yml` })
    }
    catch {
      toast.error(t('exportFailed'))
    }
  }, [exportSnippetMutation, snippet.id, snippet.name, t])

  const handleEditSnippet = React.useCallback(async ({ name, description, icon }: {
    name: string
    description: string
    icon: AppIconSelection
  }) => {
    updateSnippetMutation.mutate({
      params: { snippetId: snippet.id },
      body: {
        name,
        description: description || undefined,
        icon_info: {
          icon: icon.type === 'emoji' ? icon.icon : icon.fileId,
          icon_type: icon.type,
          icon_background: icon.type === 'emoji' ? icon.background : undefined,
          icon_url: icon.type === 'image' ? icon.url : undefined,
        },
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
          <DropdownMenuItem className="mx-0 gap-2" onClick={handleOpenEditDialog}>
            <span aria-hidden className="i-ri-edit-line size-4 shrink-0 text-text-tertiary" />
            <span className="grow">{t('menu.editInfo')}</span>
          </DropdownMenuItem>
          <DropdownMenuItem className="mx-0 gap-2" onClick={handleExportSnippet}>
            <span aria-hidden className="i-ri-download-2-line size-4 shrink-0 text-text-tertiary" />
            <span className="grow">{t('menu.exportSnippet')}</span>
          </DropdownMenuItem>
          <DropdownMenuSeparator className="!my-1 bg-divider-subtle" />
          <DropdownMenuItem
            className="mx-0 gap-2"
            destructive
            onClick={() => {
              setOpen(false)
              setIsDeleteDialogOpen(true)
            }}
          >
            <span aria-hidden className="i-ri-delete-bin-line size-4 shrink-0" />
            <span className="grow">{t('menu.deleteSnippet')}</span>
          </DropdownMenuItem>
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
        <AlertDialogContent className="w-[400px]">
          <div className="space-y-2 p-6">
            <AlertDialogTitle className="title-lg-semi-bold text-text-primary">
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
