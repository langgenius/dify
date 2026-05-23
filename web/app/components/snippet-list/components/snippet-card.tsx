'use client'

import type { SnippetListItem } from '@/types/snippet'
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
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import CreateSnippetDialog from '@/app/components/workflow/create-snippet-dialog'
import { useAppContext } from '@/context/app-context'
import { TagSelector } from '@/features/tag-management/components/tag-selector'
import Link from '@/next/link'
import { useMembers } from '@/service/use-common'
import { useDeleteSnippetMutation, useExportSnippetMutation, useUpdateSnippetMutation } from '@/service/use-snippets'
import { downloadBlob } from '@/utils/download'
import { formatTime } from '@/utils/time'

type Props = {
  snippet: SnippetListItem
  onOpenTagManagement?: () => void
  onRefresh?: () => void
  onTagsChange?: () => void
}

const SnippetCard = ({
  snippet,
  onOpenTagManagement = () => {},
  onRefresh,
  onTagsChange,
}: Props) => {
  const { t } = useTranslation('snippet')
  const { t: tCommon } = useTranslation()
  const { isCurrentWorkspaceEditor } = useAppContext()
  const { data: membersData } = useMembers()
  const [isOperationsMenuOpen, setIsOperationsMenuOpen] = useState(false)
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false)
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false)
  const updateSnippetMutation = useUpdateSnippetMutation()
  const exportSnippetMutation = useExportSnippetMutation()
  const deleteSnippetMutation = useDeleteSnippetMutation()

  const memberNameById = useMemo(() => {
    return new Map((membersData?.accounts ?? []).map(member => [member.id, member.name]))
  }, [membersData?.accounts])

  const updatedByName = memberNameById.get(snippet.updated_by)
    || memberNameById.get(snippet.created_by)
    || t('unknownUser')

  const updatedAt = snippet.updated_at || snippet.created_at
  const updatedAtText = formatTime({
    date: (updatedAt > 1_000_000_000_000 ? updatedAt : updatedAt * 1000),
    dateFormat: `${t('segment.dateTimeFormat', { ns: 'datasetDocuments' })}`,
  })
  const updatedText = t('updatedBy', {
    name: updatedByName,
    time: updatedAtText,
  })

  const initialValue = useMemo(() => ({
    name: snippet.name,
    description: snippet.description,
  }), [snippet.description, snippet.name])

  const handleOpenEditDialog = () => {
    setIsOperationsMenuOpen(false)
    setIsEditDialogOpen(true)
  }

  const handleExportSnippet = async () => {
    setIsOperationsMenuOpen(false)
    try {
      const data = await exportSnippetMutation.mutateAsync({ snippetId: snippet.id })
      const file = new Blob([data], { type: 'application/yaml' })
      downloadBlob({ data: file, fileName: `${snippet.name}.yml` })
    }
    catch {
      toast.error(t('exportFailed'))
    }
  }

  const handleDeleteSnippet = () => {
    deleteSnippetMutation.mutate({
      params: { snippetId: snippet.id },
    }, {
      onSuccess: () => {
        toast.success(t('deleted'))
        setIsDeleteDialogOpen(false)
        onRefresh?.()
      },
      onError: (error) => {
        toast.error(error instanceof Error ? error.message : t('deleteFailed'))
      },
    })
  }

  const handleUpdateSnippet = ({ name, description }: {
    name: string
    description: string
  }) => {
    updateSnippetMutation.mutate({
      params: { snippetId: snippet.id },
      body: {
        name,
        description: description || undefined,
      },
    }, {
      onSuccess: () => {
        toast.success(t('editDone'))
        setIsEditDialogOpen(false)
        onRefresh?.()
      },
      onError: (error) => {
        toast.error(error instanceof Error ? error.message : t('editFailed'))
      },
    })
  }

  return (
    <>
      <article className="group relative col-span-1 inline-flex h-55 w-full flex-col rounded-xl border border-components-card-border bg-components-card-bg p-6 shadow-sm transition-all duration-200 ease-in-out hover:-translate-y-0.5 hover:shadow-lg">
        <Link href={`/snippets/${snippet.id}/orchestrate`} className="flex min-h-0 grow flex-col">
          <div className="truncate text-lg leading-6 font-semibold text-text-secondary" title={snippet.name}>
            {snippet.name}
          </div>
          <div className="mt-1 truncate text-sm leading-5 text-text-tertiary italic" title={updatedText}>
            {updatedText}
          </div>
          <div className="mt-6 min-h-0 text-sm leading-5 text-text-tertiary">
            <div className="line-clamp-3" title={snippet.description}>
              {snippet.description}
            </div>
          </div>
        </Link>
        <div className="mt-4 mr-10">
          <TagSelector
            placement="bottom-start"
            type="snippet"
            targetId={snippet.id}
            value={snippet.tags}
            onOpenTagManagement={onOpenTagManagement}
            onTagsChange={onTagsChange}
          />
        </div>
        {isCurrentWorkspaceEditor && (
          <div
            className={cn(
              'absolute right-6 bottom-5 flex items-center transition-opacity',
              isOperationsMenuOpen
                ? 'pointer-events-auto opacity-100'
                : 'pointer-events-none opacity-0 group-focus-within:pointer-events-auto group-focus-within:opacity-100 group-hover:pointer-events-auto group-hover:opacity-100',
            )}
          >
            <DropdownMenu modal={false} open={isOperationsMenuOpen} onOpenChange={setIsOperationsMenuOpen}>
              <DropdownMenuTrigger
                aria-label={tCommon('operation.more', { ns: 'common' })}
                className="flex size-8 items-center justify-center rounded-lg border border-components-button-secondary-border bg-components-button-secondary-bg p-2 text-text-tertiary shadow-xs hover:bg-state-base-hover focus-visible:bg-state-base-hover focus-visible:ring-1 focus-visible:ring-components-input-border-active focus-visible:ring-inset data-popup-open:bg-state-base-hover"
                onClick={(e) => {
                  e.stopPropagation()
                  e.preventDefault()
                }}
              >
                <span aria-hidden className="i-ri-more-fill size-4" />
              </DropdownMenuTrigger>
              <DropdownMenuContent
                placement="bottom-end"
                sideOffset={4}
                popupClassName="w-[216px]"
              >
                <DropdownMenuItem className="gap-2 px-3" onClick={handleOpenEditDialog}>
                  <span className="system-sm-regular text-text-secondary">{t('menu.editInfo')}</span>
                </DropdownMenuItem>
                <DropdownMenuItem className="gap-2 px-3" onClick={handleExportSnippet}>
                  <span className="system-sm-regular text-text-secondary">{t('menu.exportSnippet')}</span>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  variant="destructive"
                  className="gap-2 px-3"
                  onClick={() => {
                    setIsOperationsMenuOpen(false)
                    setIsDeleteDialogOpen(true)
                  }}
                >
                  <span className="system-sm-regular">{t('menu.deleteSnippet')}</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}
      </article>
      {isEditDialogOpen && (
        <CreateSnippetDialog
          isOpen={isEditDialogOpen}
          initialValue={initialValue}
          title={t('editDialogTitle')}
          confirmText={tCommon('operation.save', { ns: 'common' })}
          isSubmitting={updateSnippetMutation.isPending}
          onClose={() => setIsEditDialogOpen(false)}
          onConfirm={handleUpdateSnippet}
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
            <AlertDialogCancelButton disabled={deleteSnippetMutation.isPending}>
              {tCommon('operation.cancel', { ns: 'common' })}
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

export default SnippetCard
