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
import CreateSnippetDialog from '@/app/components/snippets/create-snippet-dialog'
import { canCreateAndModifySnippets, canManageSnippets } from '@/app/components/snippets/utils/permission'
import { useSelector as useAppContextWithSelector } from '@/context/app-context'
import { TagSelector } from '@/features/tag-management/components/tag-selector'
import Link from '@/next/link'
import { useMembers } from '@/service/use-common'
import { useDeleteSnippetMutation, useExportSnippetMutation, useUpdateSnippetMutation } from '@/service/use-snippets'
import { downloadBlob } from '@/utils/download'
import { formatTime } from '@/utils/time'

type Props = Readonly<{
  snippet: SnippetListItem
  onOpenTagManagement?: () => void
  onRefresh?: () => void
  onTagsChange?: () => void
}>

const SnippetCard = ({
  snippet,
  onOpenTagManagement = () => {},
  onRefresh,
  onTagsChange,
}: Props) => {
  const { t } = useTranslation('snippet')
  const { t: tCommon } = useTranslation()
  const workspacePermissionKeys = useAppContextWithSelector(state => state.workspacePermissionKeys)
  const { data: membersData } = useMembers()
  const [isOperationsMenuOpen, setIsOperationsMenuOpen] = useState(false)
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false)
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false)
  const updateSnippetMutation = useUpdateSnippetMutation()
  const exportSnippetMutation = useExportSnippetMutation()
  const deleteSnippetMutation = useDeleteSnippetMutation()
  const canCreateAndModifySnippet = canCreateAndModifySnippets(workspacePermissionKeys)
  const canManageSnippet = canManageSnippets(workspacePermissionKeys)
  const canShowOperations = canCreateAndModifySnippet || canManageSnippet

  const memberNameById = useMemo(() => {
    return new Map((membersData?.accounts ?? []).map(member => [member.id, member.name]))
  }, [membersData?.accounts])

  const updatedByName = (snippet.updated_by ? memberNameById.get(snippet.updated_by) : undefined)
    || (snippet.created_by ? memberNameById.get(snippet.created_by) : undefined)
    || t('unknownUser')

  const updatedAt = snippet.updated_at || snippet.created_at
  const updatedAtText = formatTime({
    date: (updatedAt > 1_000_000_000_000 ? updatedAt : updatedAt * 1000),
    dateFormat: `${t('segment.dateTimeFormat', { ns: 'datasetDocuments' })}`,
  })
  const initialValue = useMemo(() => ({
    name: snippet.name,
    description: snippet.description ?? undefined,
  }), [snippet.description, snippet.name])

  const handleOpenEditDialog = () => {
    setIsOperationsMenuOpen(false)
    setIsEditDialogOpen(true)
  }

  const handleExportSnippet = async () => {
    if (!canCreateAndModifySnippet)
      return

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
        description,
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
      <article className="group relative col-span-1 inline-flex h-40 w-full cursor-pointer flex-col rounded-xl border border-solid border-components-card-border bg-components-card-bg shadow-sm transition-shadow duration-200 ease-in-out hover:shadow-lg">
        <Link href={`/snippets/${snippet.id}/orchestrate`} className="flex min-h-0 flex-1 flex-col">
          <div className="flex h-16.5 shrink-0 grow-0 flex-col justify-center px-3.5 pt-3.5 pb-3">
            <div className="flex items-center text-sm/5 font-semibold text-text-secondary">
              <div className="truncate" title={snippet.name}>{snippet.name}</div>
            </div>
            <div className="flex items-center gap-1 text-2xs leading-4.5 font-medium text-text-tertiary">
              <div className="truncate" title={updatedByName}>{updatedByName}</div>
              <div>·</div>
              <div className="truncate" title={updatedAtText}>{updatedAtText}</div>
            </div>
          </div>
          <div className="h-22.5 px-3.5 text-xs leading-normal text-text-tertiary">
            <div className="line-clamp-2" title={snippet.description ?? undefined}>
              {snippet.description}
            </div>
          </div>
        </Link>

        <div className="absolute right-0 bottom-1 left-0 flex h-10.5 shrink-0 items-center pt-1 pr-1.5 pb-1.5 pl-3.5">
          <div className="flex w-0 grow items-center gap-1">
            <div className="mr-10.25 min-w-0 grow overflow-hidden">
              <TagSelector
                placement="bottom-start"
                type="snippet"
                targetId={snippet.id}
                value={snippet.tags}
                onOpenTagManagement={onOpenTagManagement}
                onTagsChange={onTagsChange}
                canBindOrUnbindTags={canManageSnippet}
              />
            </div>
          </div>
          {canShowOperations && (
            <div
              className={cn(
                'absolute top-1/2 right-1.5 flex -translate-y-1/2 items-center transition-opacity',
                isOperationsMenuOpen
                  ? 'pointer-events-auto opacity-100'
                  : 'pointer-events-none opacity-0 group-focus-within:pointer-events-auto group-focus-within:opacity-100 group-hover:pointer-events-auto group-hover:opacity-100',
              )}
            >
              <div className="mx-1 h-3.5 w-px shrink-0 bg-divider-regular" />
              <DropdownMenu modal={false} open={isOperationsMenuOpen} onOpenChange={setIsOperationsMenuOpen}>
                <DropdownMenuTrigger
                  aria-label={tCommon('operation.more', { ns: 'common' })}
                  className="flex size-8 items-center justify-center rounded-md border-none bg-transparent p-2 hover:bg-state-base-hover focus-visible:bg-state-base-hover focus-visible:inset-ring-1 focus-visible:inset-ring-components-input-border-active data-popup-open:bg-state-base-hover data-popup-open:shadow-none"
                  onClick={(e) => {
                    e.stopPropagation()
                    e.preventDefault()
                  }}
                >
                  <div className="flex size-8 cursor-pointer items-center justify-center rounded-md">
                    <span className="sr-only">{tCommon('operation.more', { ns: 'common' })}</span>
                    <span aria-hidden className="i-ri-more-fill size-4 text-text-tertiary" />
                  </div>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  placement="bottom-end"
                  sideOffset={4}
                  popupClassName="w-[216px]"
                >
                  {canCreateAndModifySnippet && (
                    <>
                      <DropdownMenuItem className="gap-2 px-3" onClick={handleOpenEditDialog}>
                        <span className="system-sm-regular text-text-secondary">{t('menu.editInfo')}</span>
                      </DropdownMenuItem>
                      <DropdownMenuItem className="gap-2 px-3" onClick={handleExportSnippet}>
                        <span className="system-sm-regular text-text-secondary">{t('menu.exportSnippet')}</span>
                      </DropdownMenuItem>
                    </>
                  )}
                  {canManageSnippet && (
                    <>
                      {canCreateAndModifySnippet && <DropdownMenuSeparator />}
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
                    </>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          )}
        </div>
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
