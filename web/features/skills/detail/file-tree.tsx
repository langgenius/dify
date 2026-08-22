'use client'

import type {
  SkillDetailResponse,
  SkillFileCheckResponse,
  SkillFileResponse,
} from '@dify/contracts/api/console/workspaces/types.gen'
import type {
  DragEvent,
  MouseEvent,
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
} from 'react'
import type { SkillDropOperation, SkillDropTarget } from './file-tree-dnd'
import type {
  FileTreeInlineAction,
  FileTreeNode,
  SkillFileClipboard,
  SkillFileMutationCoordinator,
  SkillUploadQueueItem,
} from './shared'
import type { SkillUploadDecision, SkillUploadReviewItem } from './upload-workflow'
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
  ContextMenu,
  ContextMenuContent,
  ContextMenuTrigger,
} from '@langgenius/dify-ui/context-menu'
import { Dialog, DialogContent, DialogTitle } from '@langgenius/dify-ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@langgenius/dify-ui/dropdown-menu'
import { Input } from '@langgenius/dify-ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@langgenius/dify-ui/popover'
import {
  ScrollArea,
  ScrollAreaContent,
  ScrollAreaScrollbar,
  ScrollAreaThumb,
  ScrollAreaViewport,
} from '@langgenius/dify-ui/scroll-area'
import { toast } from '@langgenius/dify-ui/toast'
import { matchesKeyboardEvent, useHotkey } from '@tanstack/react-hotkeys'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import copy from 'copy-to-clipboard'
import { useCallback, useEffect, useEffectEvent, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import SidebarLeftArrowIcon from '@/app/components/base/icons/src/vender/SidebarLeftArrowIcon'
import AccountSection from '@/app/components/main-nav/components/account-section'
import HelpMenu from '@/app/components/main-nav/components/help-menu'
import Link from '@/next/link'
import { consoleQuery } from '@/service/client'
import { fetchSkillFileBlob, uploadSkillFile } from '../client'
import { SkillDropDestinationHint, SkillUploadStatusPanel } from './file-tree-dnd'
import { FileTreeItem, FileTreeNameInput, RootFileActionMenuItems } from './file-tree-items'
import {
  createUploadItemId,
  findFileByPath,
  flattenFileTree,
  getAsyncSkillErrorMessage,
  getAsyncSkillErrorPayload,
  getCopyTargetPath,
  getCreatedSkillFileMimeType,
  getDraggedSkillPaths,
  getErrorCode,
  getPathBaseName,
  getPathDirName,
  getSkillFileIconClass,
  getUploadFileName,
  getUploadPath,
  invalidateSkillDetail,
  isDirectory,
  isEditableKeyboardTarget,
  isNestedPath,
  joinSkillPath,
  refreshSkillDetailAfterConflict,
  runSkillFileMutation,
  setSkillDetailCache,
  showSkillErrorToast,
  skillFileHotkeys,
  skillFileMenuPopupClassName,
  toFileTree,
} from './shared'
import { SkillDetailSidebarActions } from './sidebar-actions'
import { SkillDisplayNameEditor } from './skill-display-name-editor'
import { SkillReferencesPanel, SkillTagsEditor } from './skill-metadata'
import { SkillUploadFailuresDialog, SkillUploadReviewDialog } from './upload-dialogs'
import {
  buildUploadReviewItems,
  createAvailableUploadPath,
  isUploadReviewItemSkipped,
  resolveUploadReviewItem,
} from './upload-workflow'

const skillSidebarMinWidth = 240
const skillSidebarMaxWidth = 420
const skillSidebarKeyboardStep = 8

const skillSidebarHelpTriggerIcon = (
  <span aria-hidden className="i-ri-question-line size-4 shrink-0" />
)

function SkillSidebarAccountFooter({ compact = false }: { compact?: boolean }) {
  return (
    <div
      className={cn(
        'shrink-0 border-t border-divider-subtle',
        compact
          ? 'flex w-full flex-col items-center gap-0.5 px-2 pt-1 pb-3'
          : 'flex h-14 w-full items-center justify-between p-3',
      )}
    >
      <div
        className={cn(
          'flex min-w-0 items-center gap-1 overflow-hidden',
          compact && 'w-full justify-center',
        )}
      >
        <AccountSection compact={compact} />
      </div>
      <HelpMenu
        triggerIcon={skillSidebarHelpTriggerIcon}
        triggerClassName={cn(
          'size-8 border-0 bg-transparent shadow-none hover:bg-state-base-hover hover:text-text-secondary',
          compact && 'mt-2',
        )}
      />
    </div>
  )
}

const clampSkillSidebarWidth = (width: number) =>
  Math.min(skillSidebarMaxWidth, Math.max(skillSidebarMinWidth, width))

function FileSearchDialog({
  files,
  onOpenChange,
  onSelect,
  open,
}: {
  files: SkillFileResponse[]
  onOpenChange: (open: boolean) => void
  onSelect: (path: string) => void
  open: boolean
}) {
  const { t } = useTranslation('skill')
  const [query, setQuery] = useState('')
  const fileResults = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()
    const fileItems = files.filter((file) => !isDirectory(file))
    if (!normalizedQuery) return fileItems

    return fileItems.filter((file) => {
      const path = file.path.toLowerCase()
      return path.includes(normalizedQuery) || getPathBaseName(path).includes(normalizedQuery)
    })
  }, [files, query])

  const handleOpenChange = (nextOpen: boolean) => {
    onOpenChange(nextOpen)
    if (!nextOpen) setQuery('')
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="top-[24dvh] w-[480px] max-w-[calc(100vw-32px)] translate-y-0 overflow-hidden! rounded-2xl border border-components-panel-border bg-components-panel-bg p-0! shadow-xl">
        <DialogTitle className="sr-only">
          {t(($) => $['skillManagement.detail.searchFiles'])}
        </DialogTitle>
        <div className="flex h-12 items-center gap-2 border-b border-divider-subtle px-4">
          <span aria-hidden className="i-ri-search-2-line size-4 shrink-0 text-text-quaternary" />
          <Input
            // oxlint-disable-next-line jsx-a11y/no-autofocus -- The file search dialog opens from an explicit search action and should focus the query field.
            autoFocus
            value={query}
            placeholder={t(($) => $['skillManagement.detail.searchFiles'])}
            aria-label={t(($) => $['skillManagement.detail.searchFiles'])}
            className="h-10 border-0 bg-transparent px-0 shadow-none focus-visible:ring-0"
            onValueChange={setQuery}
            onKeyDown={(event) => {
              if (event.key !== 'Enter') return
              const firstFile = fileResults[0]
              if (!firstFile) return

              event.preventDefault()
              onSelect(firstFile.path)
              handleOpenChange(false)
            }}
          />
        </div>
        <div className="max-h-[320px] min-h-48 overflow-y-auto p-2">
          {fileResults.length > 0 ? (
            <div className="space-y-1">
              {fileResults.map((file) => (
                <button
                  key={file.path}
                  type="button"
                  className="flex h-9 w-full cursor-pointer items-center gap-2 rounded-lg px-2 text-left outline-hidden hover:bg-state-base-hover focus-visible:ring-2 focus-visible:ring-state-accent-solid"
                  onClick={() => {
                    onSelect(file.path)
                    handleOpenChange(false)
                  }}
                >
                  <span
                    aria-hidden
                    className={cn('size-4 shrink-0', getSkillFileIconClass(file))}
                  />
                  <span className="min-w-0 flex-1 truncate system-sm-regular text-text-secondary">
                    {file.path}
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <div className="flex h-40 items-center justify-center text-center system-sm-regular text-text-tertiary">
              {t(($) => $['skillManagement.detail.noSearchResults'])}
            </div>
          )}
        </div>
        <div className="flex h-9 items-center justify-between border-t border-divider-subtle px-4 system-xs-regular text-text-quaternary">
          <span>{t(($) => $['skillManagement.detail.searchFiles'])}</span>
          <span>ESC</span>
        </div>
      </DialogContent>
    </Dialog>
  )
}

export function FileTree({
  canEdit,
  canDelete,
  collapsed,
  detail,
  fileMutationCoordinator,
  files,
  onCollapsedChange,
  onSelect,
  readonly,
  selectedPath,
  skillId,
}: {
  canEdit: boolean
  canDelete: boolean
  collapsed: boolean
  detail: SkillDetailResponse | undefined
  fileMutationCoordinator: SkillFileMutationCoordinator
  files: SkillFileResponse[]
  onCollapsedChange: (collapsed: boolean) => void
  onSelect: (path: string, files?: SkillFileResponse[], mode?: 'pinned' | 'preview') => void
  readonly: boolean
  selectedPath: string | undefined
  skillId: string
}) {
  const { t } = useTranslation('skill')
  const { t: tCommon } = useTranslation('common')
  const queryClient = useQueryClient()
  const sidebarRef = useRef<HTMLElement>(null)
  const uploadInputRef = useRef<HTMLInputElement>(null)
  const [inlineAction, setInlineAction] = useState<FileTreeInlineAction>()
  const [draggingPaths, setDraggingPaths] = useState<string[]>([])
  const [dropTarget, setDropTarget] = useState<SkillDropTarget>()
  const [collapsedFolderPaths, setCollapsedFolderPaths] = useState<string[]>([])
  const [searchDialogOpen, setSearchDialogOpen] = useState(false)
  const [skillRenameEditing, setSkillRenameEditing] = useState(false)
  const [selectedPaths, setSelectedPaths] = useState<string[]>([])
  const [selectionAnchorPath, setSelectionAnchorPath] = useState<string>()
  const [clipboard, setClipboard] = useState<SkillFileClipboard>()
  const [uploadItems, setUploadItems] = useState<SkillUploadQueueItem[]>([])
  const [uploadReviewItems, setUploadReviewItems] = useState<SkillUploadReviewItem[]>([])
  const [uploadReviewOpen, setUploadReviewOpen] = useState(false)
  const [uploadFailuresOpen, setUploadFailuresOpen] = useState(false)
  const [deleteNode, setDeleteNode] = useState<FileTreeNode>()
  const [sidebarWidth, setSidebarWidth] = useState(skillSidebarMinWidth)
  const [sidebarFloating, setSidebarFloating] = useState(false)
  const [sidebarResizing, setSidebarResizing] = useState(false)
  const referencesQuery = useQuery({
    ...consoleQuery.workspaces.current.skills.bySkillId.references.get.queryOptions({
      input: {
        params: {
          skill_id: skillId,
        },
      },
    }),
    refetchOnMount: 'always',
  })
  const referenceCount = referencesQuery.data?.data?.length ?? detail?.reference_count ?? 0
  const activeUploadXhrRef = useRef<XMLHttpRequest | undefined>(undefined)
  const cancelUploadRef = useRef(false)
  const stopSidebarResizeRef = useRef<() => void>(() => undefined)
  const closeSidebarFloatingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    const fetchedReferenceCount = referencesQuery.data?.data?.length
    if (
      fetchedReferenceCount == null ||
      !detail ||
      detail.reference_count === fetchedReferenceCount
    )
      return

    setSkillDetailCache(queryClient, skillId, {
      ...detail,
      reference_count: fetchedReferenceCount,
    })
  }, [detail, queryClient, referencesQuery.data?.data?.length, skillId])

  useEffect(
    () => () => {
      stopSidebarResizeRef.current()
      if (closeSidebarFloatingTimerRef.current) clearTimeout(closeSidebarFloatingTimerRef.current)
    },
    [],
  )

  const openSidebarFloatingPreview = () => {
    if (!collapsed) return
    if (closeSidebarFloatingTimerRef.current) clearTimeout(closeSidebarFloatingTimerRef.current)
    setSidebarFloating(true)
  }

  const closeSidebarFloatingPreview = () => {
    if (closeSidebarFloatingTimerRef.current) clearTimeout(closeSidebarFloatingTimerRef.current)
    closeSidebarFloatingTimerRef.current = setTimeout(() => setSidebarFloating(false), 120)
  }

  const handleSidebarResizePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) return

      event.preventDefault()
      stopSidebarResizeRef.current()

      const startX = event.clientX
      const startWidth = sidebarWidth
      const previousUserSelect = document.body.style.userSelect
      const previousCursor = document.body.style.cursor
      const handlePointerMove = (moveEvent: PointerEvent) => {
        setSidebarWidth(clampSkillSidebarWidth(startWidth + moveEvent.clientX - startX))
      }
      const stopResize = () => {
        document.removeEventListener('pointermove', handlePointerMove)
        document.removeEventListener('pointerup', stopResize)
        document.removeEventListener('pointercancel', stopResize)
        window.removeEventListener('blur', stopResize)
        document.body.style.userSelect = previousUserSelect
        document.body.style.cursor = previousCursor
        setSidebarResizing(false)
        stopSidebarResizeRef.current = () => undefined
      }

      setSidebarResizing(true)
      document.body.style.userSelect = 'none'
      document.body.style.cursor = 'col-resize'
      document.addEventListener('pointermove', handlePointerMove)
      document.addEventListener('pointerup', stopResize)
      document.addEventListener('pointercancel', stopResize)
      window.addEventListener('blur', stopResize)
      stopSidebarResizeRef.current = stopResize
    },
    [sidebarWidth],
  )

  const handleSidebarResizeKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    let nextWidth: number | undefined
    if (event.key === 'ArrowLeft') nextWidth = sidebarWidth - skillSidebarKeyboardStep
    if (event.key === 'ArrowRight') nextWidth = sidebarWidth + skillSidebarKeyboardStep
    if (event.key === 'Home') nextWidth = skillSidebarMinWidth
    if (event.key === 'End') nextWidth = skillSidebarMaxWidth
    if (nextWidth === undefined) return

    event.preventDefault()
    setSidebarWidth(clampSkillSidebarWidth(nextWidth))
  }

  const fileMutation = useMutation(
    consoleQuery.workspaces.current.skills.bySkillId.files.patch.mutationOptions({
      context: { silent: true },
    }),
  )
  const fileCheckMutation = useMutation(
    consoleQuery.workspaces.current.skills.bySkillId.files.check.post.mutationOptions({
      context: { silent: true },
    }),
  )
  const tree = toFileTree(files)
  const flatTree = flattenFileTree(tree)
  const isUploading = uploadItems.some(
    (item) => item.status === 'uploading' || item.status === 'saving',
  )
  const isMutating = fileMutation.isPending || fileCheckMutation.isPending || isUploading
  const fileCount = files.filter((file) => !isDirectory(file)).length

  const mutateFile = (
    body: Parameters<typeof fileMutation.mutate>[0]['body'],
    options: {
      onSuccess?: (detail: SkillDetailResponse) => void
      successMessage: string
    },
  ) => {
    if (!detail || fileMutation.isPending) return

    void runSkillFileMutation(fileMutationCoordinator, (expectedUpdatedAt) =>
      fileMutation.mutateAsync({
        params: {
          skill_id: skillId,
        },
        body: {
          ...body,
          expected_updated_at: expectedUpdatedAt,
        },
      }),
    )
      .then((nextDetail) => {
        toast.success(options.successMessage)
        setSkillDetailCache(queryClient, skillId, nextDetail)
        invalidateSkillDetail(queryClient, skillId)
        options.onSuccess?.(nextDetail)
      })
      .catch((error) => {
        showSkillErrorToast(
          error,
          t(($) => $['skillManagement.detail.fileOperationFailed']),
        )
      })
  }

  const handleSubmitInlineAction = (name: string) => {
    if (!inlineAction) return

    if (inlineAction.kind === 'rename') {
      const targetPath = joinSkillPath(getPathDirName(inlineAction.path), name)
      if (targetPath === inlineAction.path) {
        setInlineAction(undefined)
        return
      }

      mutateFile(
        {
          operation: 'rename',
          path: inlineAction.path,
          target_path: targetPath,
        },
        {
          successMessage: t(($) => $['skillManagement.detail.renameFileSuccess']),
          onSuccess: (nextDetail) => {
            setInlineAction(undefined)
            onSelect(targetPath, nextDetail.files)
          },
        },
      )
      return
    }

    const path = joinSkillPath(inlineAction.parentPath, name)
    if (files.some((file) => file.path === path)) {
      toast.error(t(($) => $['skillManagement.detail.fileAlreadyExists']))
      return
    }
    if (inlineAction.nodeType === 'directory') {
      mutateFile(
        {
          operation: 'mkdir',
          path,
        },
        {
          successMessage: t(($) => $['skillManagement.detail.createFolderSuccess']),
          onSuccess: () => {
            setInlineAction(undefined)
          },
        },
      )
      return
    }

    mutateFile(
      {
        content: '',
        mime_type: getCreatedSkillFileMimeType(path),
        operation: 'upsert_text',
        path,
        size: 0,
      },
      {
        successMessage: t(($) => $['skillManagement.detail.createFileSuccess']),
        onSuccess: (nextDetail) => {
          setInlineAction(undefined)
          onSelect(path, nextDetail.files)
        },
      },
    )
  }

  const handleDelete = () => {
    if (!deleteNode) return

    mutateFile(
      {
        operation: 'delete',
        path: deleteNode.path,
      },
      {
        successMessage: t(($) => $['skillManagement.detail.deleteFileSuccess']),
        onSuccess: () => {
          setDeleteNode(undefined)
        },
      },
    )
  }

  const patchUploadItem = (id: string, patch: Partial<SkillUploadQueueItem>) => {
    setUploadItems((currentItems) =>
      currentItems.map((item) => (item.id === id ? { ...item, ...patch } : item)),
    )
  }

  const handleUploadFiles = async (filesToUpload: File[], targetDirectory: string | undefined) => {
    if (!detail || filesToUpload.length === 0 || isMutating) return

    const itemIds = filesToUpload.map((file, index) => createUploadItemId(file, index))
    const paths = filesToUpload.map((file) => getUploadPath(file, targetDirectory))
    try {
      const response = (await fileCheckMutation.mutateAsync({
        params: { skill_id: skillId },
        body: {
          files: filesToUpload.map((file, index) => ({
            filename: file.name,
            mime_type: file.type || null,
            path: paths[index],
            size: file.size,
          })),
        },
      })) as SkillFileCheckResponse
      const reviewItems = buildUploadReviewItems({
        checks: response.data ?? {},
        existingFiles: files,
        files: filesToUpload,
        itemIds,
        paths,
      })
      setUploadReviewItems(reviewItems)
      setUploadReviewOpen(true)
    } catch {
      toast.error(t(($) => $['skillManagement.detail.uploadCheckFailed']))
    }
  }

  const startUpload = async (reviewItems: SkillUploadReviewItem[], replaceQueue = true) => {
    if (!detail || isMutating) return

    const uploadableItems = reviewItems.filter(
      (item) => !isUploadReviewItemSkipped(item) && item.resolvedPath,
    )
    const nextUploadItems = uploadableItems.map((item) => ({
      file: item.file,
      id: item.id,
      name: getUploadFileName(item.file),
      path: item.resolvedPath!,
      progress: 0,
      status: 'uploading' as const,
    }))
    if (replaceQueue) setUploadItems(nextUploadItems)
    else {
      setUploadItems((currentItems) => {
        const replacements = new Map(nextUploadItems.map((item) => [item.id, item]))
        const mergedItems = currentItems.map((item) => replacements.get(item.id) ?? item)
        const currentIds = new Set(currentItems.map((item) => item.id))
        return [...mergedItems, ...nextUploadItems.filter((item) => !currentIds.has(item.id))]
      })
    }
    setUploadFailuresOpen(false)
    cancelUploadRef.current = false

    let latestDetail = detail
    let lastUploadedPath = ''
    let successCount = 0
    let failedCount = 0

    for (const [index, file] of uploadableItems.map((item) => item.file).entries()) {
      const item = nextUploadItems[index]
      if (!item) continue
      if (cancelUploadRef.current) {
        failedCount += 1
        patchUploadItem(item.id, {
          error: tCommon(($) => $['operation.cancel']),
          progress: 100,
          status: 'failed',
        })
        continue
      }

      try {
        patchUploadItem(item.id, { progress: 0, status: 'uploading' })
        const xhr = new XMLHttpRequest()
        activeUploadXhrRef.current = xhr
        const uploadedFile = await uploadSkillFile(file, {
          onProgress: (progress) => {
            patchUploadItem(item.id, { progress: Math.min(progress, 99) })
          },
          xhr,
        })
        activeUploadXhrRef.current = undefined
        patchUploadItem(item.id, { progress: 100, status: 'saving' })

        const path = item.path
        const nextDetail = await runSkillFileMutation(
          fileMutationCoordinator,
          (expectedUpdatedAt) =>
            fileMutation.mutateAsync({
              params: {
                skill_id: skillId,
              },
              body: {
                expected_updated_at: expectedUpdatedAt,
                mime_type: uploadedFile.mime_type ?? file.type,
                operation: 'upsert_tool_file',
                path,
                size: uploadedFile.size,
                tool_file_id: uploadedFile.id,
              },
            }),
        )

        latestDetail = nextDetail
        lastUploadedPath = path
        successCount += 1
        patchUploadItem(item.id, { progress: 100, status: 'uploaded' })
      } catch (error) {
        activeUploadXhrRef.current = undefined
        failedCount += 1
        const errorPayload = await getAsyncSkillErrorPayload(error)
        const errorCode = getErrorCode(errorPayload ?? error)
        let failureKind: SkillUploadQueueItem['failureKind'] = 'network'
        let errorMessage =
          (await getAsyncSkillErrorMessage(error)) ??
          t(($) => $['skillManagement.detail.uploadNetworkFailure'])
        let suggestedPath: string | undefined
        if (errorCode === 'skill_conflict') {
          failureKind = 'conflict'
          errorMessage = t(($) => $['skillManagement.detail.uploadLateConflict'])
          try {
            const refreshedDetail = await refreshSkillDetailAfterConflict(queryClient, skillId)
            fileMutationCoordinator.latestDetail = refreshedDetail
            latestDetail = refreshedDetail
            suggestedPath = createAvailableUploadPath(
              item.path,
              (refreshedDetail.files ?? []).map((file) => file.path),
            )
          } catch {
            // Replace remains available even if refreshing the latest paths fails.
          }
        }
        patchUploadItem(item.id, {
          error: errorMessage,
          failureKind,
          progress: 100,
          status: 'failed',
          suggestedPath,
        })
      }
    }

    if (successCount > 0) {
      setSkillDetailCache(queryClient, skillId, latestDetail)
      invalidateSkillDetail(queryClient, skillId)
      if (lastUploadedPath) onSelect(lastUploadedPath, latestDetail.files)
    }

    if (failedCount > 0) {
      toast.error(
        t(($) => $['skillManagement.detail.uploadFilesFailedStatus'], { count: failedCount }),
      )
      return
    }

    toast.success(t(($) => $['skillManagement.detail.uploadFileSuccess']))
  }

  const handleCancelUpload = () => {
    cancelUploadRef.current = true
    activeUploadXhrRef.current?.abort()
  }

  const handleRetryUpload = () => {
    const failedItems = uploadItems.filter(
      (item) => item.status === 'failed' && item.failureKind !== 'conflict',
    )
    void startUpload(
      failedItems.map((item) => ({
        check: {
          errors: [],
          extension: '',
          filename: item.file.name,
          mime_type: item.file.type,
          path: item.path,
          size: item.file.size,
        },
        file: item.file,
        id: item.id,
        kind: 'ready',
        originalPath: item.path,
        resolvedPath: item.path,
      })),
      false,
    )
  }

  const handleRetryUploadItem = (id: string, path?: string) => {
    const item = uploadItems.find((uploadItem) => uploadItem.id === id)
    if (!item) return
    const resolvedPath = path ?? item.path
    setUploadFailuresOpen(false)
    void startUpload(
      [
        {
          check: {
            errors: [],
            extension: '',
            filename: item.file.name,
            mime_type: item.file.type,
            path: resolvedPath,
            size: item.file.size,
          },
          file: item.file,
          id: item.id,
          kind: 'ready',
          originalPath: item.path,
          resolvedPath,
        },
      ],
      false,
    )
  }

  const handleFailedUploadDecision = (id: string, decision: SkillUploadDecision) => {
    const item = uploadItems.find((uploadItem) => uploadItem.id === id)
    if (!item) return
    if (decision === 'skip') {
      setUploadItems((currentItems) => currentItems.filter((uploadItem) => uploadItem.id !== id))
      if (uploadItems.filter((uploadItem) => uploadItem.status === 'failed').length === 1)
        setUploadFailuresOpen(false)
      return
    }
    handleRetryUploadItem(id, decision === 'keep-both' ? item.suggestedPath : item.path)
  }

  const handleUploadDecision = (id: string, decision: SkillUploadDecision) => {
    setUploadReviewItems((currentItems) =>
      currentItems.map((item) => (item.id === id ? resolveUploadReviewItem(item, decision) : item)),
    )
  }

  const handleConfirmUpload = () => {
    setUploadReviewOpen(false)
    void startUpload(uploadReviewItems)
  }

  const handleItemSelect = (node: FileTreeNode, event: MouseEvent<HTMLElement>) => {
    const currentPath = node.path
    const isAdditive = event.metaKey || event.ctrlKey

    if (event.shiftKey && selectionAnchorPath) {
      const anchorIndex = flatTree.findIndex((item) => item.path === selectionAnchorPath)
      const currentIndex = flatTree.findIndex((item) => item.path === currentPath)

      if (anchorIndex >= 0 && currentIndex >= 0) {
        const [startIndex, endIndex] =
          anchorIndex < currentIndex ? [anchorIndex, currentIndex] : [currentIndex, anchorIndex]
        const rangePaths = flatTree.slice(startIndex, endIndex + 1).map((item) => item.path)

        setSelectedPaths(
          isAdditive ? Array.from(new Set([...selectedPaths, ...rangePaths])) : rangePaths,
        )
        return
      }
    }

    if (isAdditive) {
      setSelectedPaths((currentPaths) =>
        currentPaths.includes(currentPath)
          ? currentPaths.filter((path) => path !== currentPath)
          : [...currentPaths, currentPath],
      )
      setSelectionAnchorPath(currentPath)
      return
    }

    setSelectedPaths([currentPath])
    setSelectionAnchorPath(currentPath)
  }

  const getMovablePaths = (sourcePaths: string[], targetDirectory: string | undefined) => {
    const uniquePaths = Array.from(new Set(sourcePaths))
    return uniquePaths.filter((sourcePath) => {
      if (
        targetDirectory &&
        (sourcePath === targetDirectory || isNestedPath(sourcePath, targetDirectory))
      )
        return false

      return !uniquePaths.some(
        (candidatePath) => candidatePath !== sourcePath && isNestedPath(candidatePath, sourcePath),
      )
    })
  }

  const getActionPaths = (path: string) => (selectedPaths.includes(path) ? selectedPaths : [path])
  const getFileActionPaths = (path: string) =>
    getActionPaths(path).filter((actionPath) => {
      const file = findFileByPath(files, actionPath)
      return file && !isDirectory(file)
    })

  const handleCut = (path: string) => {
    const filePaths = getFileActionPaths(path)
    if (filePaths.length === 0) return

    setClipboard({ mode: 'cut', paths: filePaths })
    toast.success(t(($) => $['skillManagement.detail.cutFileSuccess']))
  }

  const handleCopy = (path: string) => {
    const filePaths = getFileActionPaths(path)
    if (filePaths.length === 0) return

    setClipboard({ mode: 'copy', paths: filePaths })
    const copiedFile = filePaths.length === 1 ? findFileByPath(files, filePaths[0]) : undefined
    if (copiedFile && typeof copiedFile.content === 'string') {
      copy(copiedFile.content)
      toast.success(t(($) => $['skillManagement.detail.copyContentSuccess']))
      return
    }

    toast.success(t(($) => $['skillManagement.detail.copyFileSuccess']))
  }

  const handleMove = async (sourcePaths: string[], targetDirectory: string | undefined) => {
    if (!detail || fileMutation.isPending) return
    const movablePaths = getMovablePaths(sourcePaths, targetDirectory)
    if (movablePaths.length === 0) return

    try {
      let lastTargetPath = ''
      let latestDetail = detail
      const movedTargetPaths: string[] = []
      for (const sourcePath of movablePaths) {
        const targetPath = joinSkillPath(targetDirectory, getPathBaseName(sourcePath))
        if (sourcePath === targetPath) continue

        const nextDetail = await runSkillFileMutation(
          fileMutationCoordinator,
          (expectedUpdatedAt) =>
            fileMutation.mutateAsync({
              params: {
                skill_id: skillId,
              },
              body: {
                expected_updated_at: expectedUpdatedAt,
                operation: 'rename',
                path: sourcePath,
                target_path: targetPath,
              },
            }),
        )
        latestDetail = nextDetail
        lastTargetPath = targetPath
        movedTargetPaths.push(targetPath)
      }

      if (movedTargetPaths.length === 0) return
      toast.success(
        movedTargetPaths.length > 1
          ? t(($) => $['skillManagement.detail.moveFilesSuccess'])
          : t(($) => $['skillManagement.detail.moveFileSuccess']),
      )
      setSkillDetailCache(queryClient, skillId, latestDetail)
      invalidateSkillDetail(queryClient, skillId)
      setSelectedPaths(movedTargetPaths)
      if (lastTargetPath) onSelect(lastTargetPath, latestDetail.files)
    } catch (error) {
      showSkillErrorToast(
        error,
        t(($) => $['skillManagement.detail.fileOperationFailed']),
      )
    }
  }

  const handleCopyFiles = async (sourcePaths: string[], targetDirectory: string | undefined) => {
    if (!detail || fileMutation.isPending) return

    try {
      let latestDetail = fileMutationCoordinator.latestDetail ?? detail
      const copyablePaths = getMovablePaths(sourcePaths, targetDirectory).filter((sourcePath) => {
        const file = findFileByPath(latestDetail.files ?? [], sourcePath)
        return file && !isDirectory(file)
      })
      let lastTargetPath = ''
      const copiedTargetPaths: string[] = []
      let hasRetriedConflict = false

      for (const sourcePath of copyablePaths) {
        while (true) {
          const operationFiles = latestDetail.files ?? []
          const sourceFile = findFileByPath(operationFiles, sourcePath)
          if (!sourceFile || isDirectory(sourceFile)) break
          const targetPath = getCopyTargetPath(
            operationFiles,
            targetDirectory,
            sourcePath,
            copiedTargetPaths,
          )
          if (!targetPath) throw new Error('target path already exists')

          try {
            let nextDetail: SkillDetailResponse
            if (sourceFile.tool_file_id) {
              nextDetail = await runSkillFileMutation(
                fileMutationCoordinator,
                (expectedUpdatedAt) =>
                  fileMutation.mutateAsync({
                    params: {
                      skill_id: skillId,
                    },
                    body: {
                      expected_updated_at: expectedUpdatedAt,
                      hash: sourceFile.hash,
                      mime_type: sourceFile.mime_type,
                      operation: 'upsert_tool_file',
                      path: targetPath,
                      size: sourceFile.size,
                      tool_file_id: sourceFile.tool_file_id,
                    },
                  }),
              )
            } else {
              const content =
                sourceFile.content ??
                (await (
                  await fetchSkillFileBlob({
                    path: sourcePath,
                    skillId,
                    versionId: null,
                  })
                ).text())
              nextDetail = await runSkillFileMutation(
                fileMutationCoordinator,
                (expectedUpdatedAt) =>
                  fileMutation.mutateAsync({
                    params: {
                      skill_id: skillId,
                    },
                    body: {
                      content,
                      expected_updated_at: expectedUpdatedAt,
                      hash: sourceFile.hash,
                      mime_type: sourceFile.mime_type,
                      operation: 'upsert_text',
                      path: targetPath,
                      size: new Blob([content]).size,
                    },
                  }),
              )
            }
            latestDetail = nextDetail
            lastTargetPath = targetPath
            copiedTargetPaths.push(targetPath)
            break
          } catch (error) {
            const errorPayload = await getAsyncSkillErrorPayload(error)
            if (hasRetriedConflict || getErrorCode(errorPayload ?? error) !== 'skill_conflict')
              throw error

            latestDetail = await refreshSkillDetailAfterConflict(queryClient, skillId)
            fileMutationCoordinator.latestDetail = latestDetail
            hasRetriedConflict = true
          }
        }
      }

      if (copiedTargetPaths.length === 0) return

      toast.success(t(($) => $['skillManagement.detail.pasteFileSuccess']))
      setSkillDetailCache(queryClient, skillId, latestDetail)
      invalidateSkillDetail(queryClient, skillId)
      setSelectedPaths(copiedTargetPaths)
      if (lastTargetPath) onSelect(lastTargetPath, latestDetail.files)
    } catch (error) {
      showSkillErrorToast(
        error,
        t(($) => $['skillManagement.detail.fileOperationFailed']),
      )
    }
  }

  const handlePaste = (targetDirectory: string | undefined) => {
    if (!clipboard) return

    if (clipboard.mode === 'cut') {
      void handleMove(clipboard.paths, targetDirectory)
      setClipboard(undefined)
      return
    }

    void handleCopyFiles(clipboard.paths, targetDirectory)
  }

  const getPasteTargetDirectory = () => {
    if (selectedPaths.length !== 1) return undefined

    const selectedFile = findFileByPath(files, selectedPaths[0])
    if (!selectedFile) return undefined
    if (isDirectory(selectedFile)) return selectedFile.path

    return getPathDirName(selectedFile.path) || undefined
  }

  const shortcutTargetPath = selectedPaths[0] ?? selectedPath
  const fileShortcutEnabled =
    !readonly && !!shortcutTargetPath && !fileMutation.isPending && !inlineAction
  const isInSidebar = (target: EventTarget | null) =>
    target instanceof Node && !!sidebarRef.current?.contains(target)
  const handleOpenMenuHotkey = useEffectEvent((event: globalThis.KeyboardEvent) => {
    if (readonly || fileMutation.isPending || inlineAction) return
    if (!(event.target instanceof Element) || !event.target.closest('[role="menu"]')) return

    if (
      shortcutTargetPath &&
      (matchesKeyboardEvent(event, 'Meta+X') || matchesKeyboardEvent(event, 'Control+X'))
    ) {
      event.preventDefault()
      event.stopPropagation()
      handleCut(shortcutTargetPath)
      return
    }

    if (
      shortcutTargetPath &&
      (matchesKeyboardEvent(event, 'Meta+C') || matchesKeyboardEvent(event, 'Control+C'))
    ) {
      event.preventDefault()
      event.stopPropagation()
      handleCopy(shortcutTargetPath)
      return
    }

    if (
      clipboard &&
      (matchesKeyboardEvent(event, 'Meta+V') || matchesKeyboardEvent(event, 'Control+V'))
    ) {
      event.preventDefault()
      event.stopPropagation()
      handlePaste(getPasteTargetDirectory())
    }
  })

  useEffect(() => {
    document.addEventListener('keydown', handleOpenMenuHotkey, true)
    return () => document.removeEventListener('keydown', handleOpenMenuHotkey, true)
  }, [])

  useHotkey(
    skillFileHotkeys.cut.command,
    (event) => {
      if (!shortcutTargetPath) return
      if (!isInSidebar(event.target)) return

      event.preventDefault()
      event.stopPropagation()
      handleCut(shortcutTargetPath)
    },
    {
      enabled: fileShortcutEnabled,
      ignoreInputs: true,
      preventDefault: false,
      stopPropagation: false,
    },
  )
  useHotkey(
    skillFileHotkeys.copy.command,
    (event) => {
      if (!shortcutTargetPath) return
      if (!isInSidebar(event.target)) return

      event.preventDefault()
      event.stopPropagation()
      handleCopy(shortcutTargetPath)
    },
    {
      enabled: fileShortcutEnabled,
      ignoreInputs: true,
      preventDefault: false,
      stopPropagation: false,
    },
  )

  const handleNativeCopy = useEffectEvent((event: ClipboardEvent) => {
    if (!fileShortcutEnabled || !shortcutTargetPath) return
    if (!isInSidebar(event.target)) return
    if (isEditableKeyboardTarget(event.target)) return

    event.preventDefault()
    handleCopy(shortcutTargetPath)
  })
  const handleNativeCut = useEffectEvent((event: ClipboardEvent) => {
    if (!fileShortcutEnabled || !shortcutTargetPath) return
    if (!isInSidebar(event.target)) return
    if (isEditableKeyboardTarget(event.target)) return

    event.preventDefault()
    handleCut(shortcutTargetPath)
  })

  useEffect(() => {
    document.addEventListener('copy', handleNativeCopy, true)
    document.addEventListener('cut', handleNativeCut, true)
    return () => {
      document.removeEventListener('copy', handleNativeCopy, true)
      document.removeEventListener('cut', handleNativeCut, true)
    }
  }, [])

  useEffect(() => {
    const handlePasteEvent = (event: ClipboardEvent) => {
      if (readonly || !clipboard || fileMutation.isPending) return
      if (!isInSidebar(event.target)) return
      if (isEditableKeyboardTarget(event.target)) return

      event.preventDefault()
      requestAnimationFrame(() => {
        handlePaste(getPasteTargetDirectory())
      })
    }

    document.addEventListener('paste', handlePasteEvent)
    return () => document.removeEventListener('paste', handlePasteEvent)
  })

  const handleRootDragOver = (event: DragEvent<HTMLElement>) => {
    if (readonly) return

    event.preventDefault()
    const operation: SkillDropOperation = Array.from(event.dataTransfer.types).includes('Files')
      ? 'upload'
      : 'move'
    event.dataTransfer.dropEffect = operation === 'upload' ? 'copy' : 'move'
    setDropTarget({ operation, path: '' })
  }

  const handleRootDrop = (event: DragEvent<HTMLElement>) => {
    if (readonly) return

    event.preventDefault()
    setDropTarget(undefined)

    const droppedFiles = Array.from(event.dataTransfer.files)
    if (droppedFiles.length > 0) {
      void handleUploadFiles(droppedFiles, undefined)
      return
    }

    const sourcePaths = getDraggedSkillPaths(event.dataTransfer)
    if (sourcePaths.length > 0) void handleMove(sourcePaths, undefined)
  }

  const handleRootDragLeave = (event: DragEvent<HTMLElement>) => {
    if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget))
      return

    setDropTarget(undefined)
  }

  const handleRootClick = (event: MouseEvent<HTMLElement>) => {
    const target = event.target
    if (target instanceof Element && target.closest('[data-skill-file-tree-item]')) return

    setSelectedPaths([])
    setSelectionAnchorPath(undefined)
  }

  const creatorName = detail?.created_by_name ?? detail?.created_by ?? '-'
  if (collapsed && !sidebarFloating) {
    return (
      <aside
        data-testid="skill-detail-sidebar-shell"
        className="relative flex h-full w-16 shrink-0 bg-background-body p-1"
        onMouseEnter={openSidebarFloatingPreview}
        onMouseLeave={closeSidebarFloatingPreview}
      >
        <div className="flex min-h-0 w-14 flex-1 flex-col items-center overflow-hidden rounded-lg bg-components-panel-bg">
          <button
            type="button"
            aria-label={t(($) => $['skillManagement.detail.expandSidebar'])}
            title={t(($) => $['skillManagement.detail.expandSidebar'])}
            className="mt-2 flex size-8 cursor-pointer items-center justify-center rounded-[10px] border-0 bg-transparent text-text-tertiary shadow-none outline-hidden hover:bg-state-base-hover hover:text-text-secondary focus-visible:ring-2 focus-visible:ring-state-accent-solid"
            onClick={() => onCollapsedChange(false)}
          >
            <SidebarLeftArrowIcon aria-hidden className="size-4" />
          </button>
          <div aria-hidden className="my-1 h-px w-7 bg-divider-subtle" />
          <div className="flex size-10 shrink-0 items-center justify-center rounded-[10px] border-[0.5px] border-divider-regular bg-background-default text-text-secondary">
            <span aria-hidden className="i-custom-vender-main-nav-skill size-5" />
          </div>
          <div className="mt-auto w-full">
            <SkillSidebarAccountFooter compact />
          </div>
        </div>
      </aside>
    )
  }

  return (
    <>
      <aside
        ref={sidebarRef}
        data-testid="skill-detail-sidebar-shell"
        className={cn(
          'relative flex h-full shrink-0 bg-background-body p-1',
          collapsed ? 'w-16' : 'overflow-visible',
        )}
        style={collapsed ? undefined : { width: sidebarWidth + 8 }}
        onMouseEnter={collapsed ? openSidebarFloatingPreview : undefined}
        onMouseLeave={collapsed ? closeSidebarFloatingPreview : undefined}
      >
        <div
          data-testid="skill-detail-sidebar"
          className={cn(
            'group/sidebar relative flex min-h-0 flex-col rounded-lg bg-components-panel-bg',
            collapsed && sidebarFloating
              ? 'absolute top-1 bottom-1 left-1 z-40 w-60 overflow-hidden border border-divider-subtle shadow-lg'
              : 'flex-1 overflow-visible',
          )}
          style={{ width: collapsed ? skillSidebarMinWidth : sidebarWidth }}
        >
          {!collapsed && (
            <div
              role="separator"
              aria-label={t(($) => $['skillManagement.detail.resizeSidebar'])}
              aria-orientation="vertical"
              aria-valuemax={skillSidebarMaxWidth}
              aria-valuemin={skillSidebarMinWidth}
              aria-valuenow={sidebarWidth}
              tabIndex={0}
              className="group/resize absolute top-0 -right-2 z-40 flex h-full w-4 cursor-col-resize touch-none items-center justify-center outline-hidden"
              onKeyDown={handleSidebarResizeKeyDown}
              onPointerDown={handleSidebarResizePointerDown}
            >
              <span
                aria-hidden
                className={cn(
                  'absolute right-[5px] h-10 w-0.5 rounded-full bg-state-base-handle opacity-0 transition-[height,background-color,opacity] group-hover/resize:opacity-100 group-focus-visible/resize:opacity-100',
                  sidebarResizing && 'h-full bg-state-accent-solid opacity-100',
                )}
              />
            </div>
          )}
          <div
            data-testid="skill-detail-sidebar-header"
            className="flex h-12 shrink-0 items-center py-2 pr-2 pl-1"
          >
            <div className="flex min-w-0 flex-1 items-center gap-px">
              <Link
                href="/skills"
                className="flex shrink-0 items-center rounded-lg py-2 pr-1.5 pl-0.5 text-text-tertiary outline-hidden hover:bg-background-default-hover hover:text-text-secondary focus-visible:ring-2 focus-visible:ring-state-accent-solid"
                aria-label={t(($) => $['skillManagement.detail.back'])}
              >
                <span aria-hidden className="i-ri-arrow-left-s-line size-4" />
                <span aria-hidden className="i-custom-vender-main-nav-app-home size-4" />
              </Link>
              <span className="shrink-0 system-md-regular text-text-quaternary">/</span>
              <Link
                href="/skills"
                className="shrink-0 truncate rounded-lg px-1.5 py-2 system-sm-semibold-uppercase text-text-secondary transition-colors hover:bg-background-default-hover hover:text-text-primary focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden"
              >
                SKILLS
              </Link>
            </div>
            <button
              type="button"
              aria-label={t(($) => $['skillManagement.detail.searchFiles'])}
              title={t(($) => $['skillManagement.detail.searchFiles'])}
              className="flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-[10px] text-text-tertiary outline-hidden hover:bg-state-base-hover hover:text-text-secondary focus-visible:ring-2 focus-visible:ring-state-accent-solid"
              onClick={() => setSearchDialogOpen(true)}
            >
              <span aria-hidden className="i-custom-vender-main-nav-quick-search size-4" />
            </button>
            <button
              type="button"
              aria-label={t(($) => $['skillManagement.detail.collapseSidebar'])}
              title={t(($) => $['skillManagement.detail.collapseSidebar'])}
              className="flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-[10px] border-0 bg-transparent text-text-tertiary shadow-none outline-hidden hover:bg-state-base-hover hover:text-text-secondary focus-visible:ring-2 focus-visible:ring-state-accent-solid"
              onClick={() => {
                if (collapsed) {
                  setSidebarFloating(false)
                  onCollapsedChange(false)
                } else {
                  onCollapsedChange(true)
                }
              }}
            >
              <SidebarLeftArrowIcon aria-hidden className="size-4" />
            </button>
          </div>
          <div className="p-3">
            <div className="flex min-h-10 items-start gap-2">
              <div className="flex size-10 shrink-0 items-center justify-center rounded-[10px] border-[0.5px] border-divider-regular bg-background-default">
                <span
                  aria-hidden
                  className="i-custom-vender-main-nav-skill size-5 text-text-secondary"
                />
              </div>
              <div className="min-w-0 flex-1">
                {detail ? (
                  <SkillDisplayNameEditor
                    detail={detail}
                    editing={skillRenameEditing}
                    fileMutationCoordinator={fileMutationCoordinator}
                    onEditingChange={setSkillRenameEditing}
                    readonly={readonly}
                    skillId={skillId}
                  />
                ) : (
                  <div className="w-full truncate rounded-md px-1 py-0.5 system-md-semibold text-text-secondary">
                    {skillId}
                  </div>
                )}
                <p className="truncate px-1 system-xs-regular text-text-tertiary">
                  {detail?.name ?? skillId}
                </p>
              </div>
              {!readonly &&
                detail &&
                (canEdit || canDelete || !!detail.latest_published_version_id) && (
                  <SkillDetailSidebarActions
                    canDelete={canDelete}
                    canEdit={canEdit}
                    detail={detail}
                    onRename={() => setSkillRenameEditing(true)}
                  />
                )}
            </div>
            <SkillTagsEditor
              detail={detail}
              fileMutationCoordinator={fileMutationCoordinator}
              readonly={readonly}
              skillId={skillId}
            />
          </div>
          <div className="flex h-[17px] shrink-0 items-center px-3">
            <div className="h-px w-full bg-gradient-to-r from-divider-subtle to-transparent" />
          </div>
          <div className="flex h-8 shrink-0 items-center gap-1 px-3">
            <h2 className="min-w-0 flex-1 system-xs-medium-uppercase text-text-tertiary">
              {t(
                ($) =>
                  fileCount === 1
                    ? $['skillManagement.detail.fileCount_one']
                    : $['skillManagement.detail.fileCount_other'],
                { count: fileCount },
              )}
            </h2>
            {!readonly && (
              <DropdownMenu modal={false}>
                <DropdownMenuTrigger
                  className="flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-lg text-text-secondary outline-hidden hover:bg-state-base-hover focus-visible:ring-2 focus-visible:ring-state-accent-solid data-popup-open:bg-state-base-hover"
                  disabled={!detail || isMutating}
                >
                  <span aria-hidden className="i-ri-add-line size-4" />
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  placement="bottom-end"
                  popupClassName={skillFileMenuPopupClassName}
                >
                  <RootFileActionMenuItems
                    kind="dropdown"
                    onCreateFile={() =>
                      setInlineAction({
                        kind: 'create',
                        nodeType: 'file',
                      })
                    }
                    onCreateFolder={() =>
                      setInlineAction({
                        kind: 'create',
                        nodeType: 'directory',
                      })
                    }
                    onUploadFiles={() => uploadInputRef.current?.click()}
                  />
                </DropdownMenuContent>
              </DropdownMenu>
            )}
            <input
              ref={uploadInputRef}
              type="file"
              multiple
              className="hidden"
              onChange={(event) => {
                void handleUploadFiles(Array.from(event.target.files ?? []), undefined)
                event.target.value = ''
              }}
            />
          </div>
          <ScrollArea className="relative min-h-0 flex-1 overflow-hidden">
            <ScrollAreaViewport tabIndex={-1}>
              <ScrollAreaContent
                className={cn(
                  'relative flex min-h-full min-w-0 flex-col rounded-lg px-1 pt-1 pb-3',
                  dropTarget?.path === '' &&
                    'bg-components-dropzone-bg-accent before:pointer-events-none before:absolute before:inset-0.5 before:z-10 before:rounded-lg before:border-[1.5px] before:border-dashed before:border-components-dropzone-border-accent',
                )}
                onDragLeave={handleRootDragLeave}
                onDragOver={handleRootDragOver}
                onDrop={handleRootDrop}
                onClick={handleRootClick}
              >
                <ContextMenu>
                  <ContextMenuTrigger
                    data-skill-file-tree-context-region
                    className="block w-full flex-1"
                    onContextMenuCapture={(event) => {
                      const target = event.target
                      if (
                        !(target instanceof Element) ||
                        !target.closest('[data-skill-file-tree-item]')
                      ) {
                        setSelectedPaths([])
                        setSelectionAnchorPath(undefined)
                      }
                      if (readonly || !detail || isMutating) {
                        event.preventDefault()
                        event.stopPropagation()
                      }
                    }}
                  >
                    {tree.length === 0 && inlineAction?.kind !== 'create' ? (
                      <p className="px-2 py-3 system-xs-regular text-text-tertiary">
                        {t(($) => $['skillManagement.detail.noFiles'])}
                      </p>
                    ) : (
                      <ul className="min-w-0 space-y-px">
                        {inlineAction?.kind === 'create' &&
                          inlineAction.parentPath === undefined && (
                            <FileTreeNameInput
                              loading={fileMutation.isPending}
                              nodeType={inlineAction.nodeType}
                              onCancel={() => setInlineAction(undefined)}
                              onSubmit={handleSubmitInlineAction}
                              placeholder={
                                inlineAction.nodeType === 'file'
                                  ? t(($) => $['skillManagement.detail.createFile'])
                                  : t(($) => $['skillManagement.detail.createFolder'])
                              }
                            />
                          )}
                        {tree.map((node) => (
                          <FileTreeItem
                            collapsedFolderPaths={collapsedFolderPaths}
                            detail={detail}
                            draggingPaths={draggingPaths}
                            dropTarget={dropTarget}
                            inlineAction={inlineAction}
                            inlineActionLoading={fileMutation.isPending}
                            key={node.id}
                            node={node}
                            onCancelInlineAction={() => setInlineAction(undefined)}
                            onCopy={handleCopy}
                            onCreate={(nodeType, parentPath) =>
                              setInlineAction({
                                kind: 'create',
                                nodeType,
                                parentPath,
                              })
                            }
                            onCut={handleCut}
                            onDelete={setDeleteNode}
                            onDropFiles={(filesToUpload, targetDirectory) => {
                              void handleUploadFiles(filesToUpload, targetDirectory)
                            }}
                            onItemSelect={handleItemSelect}
                            onMove={handleMove}
                            onRename={(nodeToRename) =>
                              setInlineAction({
                                kind: 'rename',
                                nodeType: nodeToRename.type,
                                path: nodeToRename.path,
                              })
                            }
                            onSelect={(path, mode) => onSelect(path, undefined, mode)}
                            onExpandFolder={(path) =>
                              setCollapsedFolderPaths((paths) =>
                                paths.filter((folderPath) => folderPath !== path),
                              )
                            }
                            onSetDraggingPaths={setDraggingPaths}
                            onSetDropTarget={setDropTarget}
                            onSubmitInlineAction={handleSubmitInlineAction}
                            onToggleFolder={(path) =>
                              setCollapsedFolderPaths((paths) =>
                                paths.includes(path)
                                  ? paths.filter((folderPath) => folderPath !== path)
                                  : [...paths, path],
                              )
                            }
                            onUploadFiles={(filesToUpload, targetDirectory) => {
                              void handleUploadFiles(filesToUpload, targetDirectory)
                            }}
                            readonly={readonly}
                            selectedPaths={selectedPaths}
                            selectedPath={selectedPath}
                          />
                        ))}
                      </ul>
                    )}
                  </ContextMenuTrigger>
                  <ContextMenuContent popupClassName={skillFileMenuPopupClassName}>
                    <RootFileActionMenuItems
                      kind="context"
                      onCreateFile={() =>
                        setInlineAction({
                          kind: 'create',
                          nodeType: 'file',
                        })
                      }
                      onCreateFolder={() =>
                        setInlineAction({
                          kind: 'create',
                          nodeType: 'directory',
                        })
                      }
                      onUploadFiles={() => uploadInputRef.current?.click()}
                    />
                  </ContextMenuContent>
                </ContextMenu>
              </ScrollAreaContent>
            </ScrollAreaViewport>
            <ScrollAreaScrollbar>
              <ScrollAreaThumb />
            </ScrollAreaScrollbar>
            {dropTarget ? (
              <SkillDropDestinationHint target={dropTarget} />
            ) : (
              <SkillUploadStatusPanel
                items={uploadItems}
                onCancel={handleCancelUpload}
                onDismiss={() => setUploadItems([])}
                onViewErrors={() => setUploadFailuresOpen(true)}
              />
            )}
          </ScrollArea>
          <SkillUploadReviewDialog
            items={uploadReviewItems}
            open={uploadReviewOpen}
            onDecision={handleUploadDecision}
            onOpenChange={setUploadReviewOpen}
            onUpload={handleConfirmUpload}
          />
          <SkillUploadFailuresDialog
            items={uploadItems}
            open={uploadFailuresOpen}
            onDecision={handleFailedUploadDecision}
            onDismiss={() => setUploadFailuresOpen(false)}
            onRetry={handleRetryUpload}
            onRetryItem={handleRetryUploadItem}
          />
          <AlertDialog
            open={!!deleteNode}
            onOpenChange={(open) => !open && setDeleteNode(undefined)}
          >
            <AlertDialogContent className="p-6">
              <AlertDialogTitle className="title-2xl-semi-bold text-text-primary">
                {t(($) => $['skillManagement.detail.deleteFileConfirm'])}
              </AlertDialogTitle>
              <AlertDialogDescription className="mt-2 system-md-regular text-text-tertiary">
                {deleteNode?.path}
              </AlertDialogDescription>
              <AlertDialogActions className="p-0 pt-6">
                <AlertDialogCancelButton disabled={fileMutation.isPending}>
                  {tCommon(($) => $['operation.cancel'])}
                </AlertDialogCancelButton>
                <AlertDialogConfirmButton
                  tone="destructive"
                  loading={fileMutation.isPending}
                  onClick={handleDelete}
                >
                  {tCommon(($) => $['operation.delete'])}
                </AlertDialogConfirmButton>
              </AlertDialogActions>
            </AlertDialogContent>
          </AlertDialog>
          <div className="mx-3 border-t border-divider-subtle pt-2 pb-3">
            <Popover>
              <PopoverTrigger
                render={
                  <button
                    type="button"
                    className="-mx-2 flex h-6 w-[calc(100%+16px)] cursor-pointer items-center gap-2 rounded-md px-2.5 text-left system-xs-regular text-text-tertiary outline-hidden hover:bg-state-base-hover hover:text-text-secondary focus-visible:ring-2 focus-visible:ring-state-accent-solid data-popup-open:bg-state-base-hover data-popup-open:text-text-secondary"
                  >
                    <span aria-hidden className="i-ri-apps-2-line size-4 shrink-0" />
                    <span className="min-w-0 flex-1 truncate">
                      {t(
                        ($) =>
                          referenceCount === 1
                            ? $['skillManagement.detail.referencedBy_one']
                            : $['skillManagement.detail.referencedBy_other'],
                        { count: referenceCount },
                      )}
                    </span>
                    <span
                      aria-hidden
                      className="i-ri-arrow-right-s-line size-4 shrink-0 text-text-quaternary"
                    />
                  </button>
                }
              />
              <PopoverContent
                placement="top-start"
                sideOffset={4}
                popupClassName="w-(--anchor-width) max-w-(--available-width) bg-components-panel-bg-blur p-1 shadow-shadow-shadow-5 backdrop-blur-[5px]"
                popupProps={{
                  'aria-label': t(
                    ($) =>
                      referenceCount === 1
                        ? $['skillManagement.detail.referencedBy_one']
                        : $['skillManagement.detail.referencedBy_other'],
                    { count: referenceCount },
                  ),
                }}
              >
                <div className="px-1 pt-1.5 pb-1 system-xs-medium text-text-tertiary">
                  {t(
                    ($) =>
                      referenceCount === 1
                        ? $['skillManagement.detail.referencedBy_one']
                        : $['skillManagement.detail.referencedBy_other'],
                    { count: referenceCount },
                  )}
                </div>
                <SkillReferencesPanel
                  compact
                  embedded
                  maxHeight="max-h-[240px]"
                  skillId={skillId}
                />
              </PopoverContent>
            </Popover>
            <div className="-mx-2 flex h-6 w-[calc(100%+16px)] items-center gap-2 px-2.5 system-xs-regular text-text-tertiary">
              <span aria-hidden className="i-ri-account-circle-line size-4 shrink-0" />
              <span className="min-w-0 truncate">
                {t(($) => $['skillManagement.detail.createdBy'], {
                  name: creatorName,
                })}
              </span>
            </div>
          </div>
          <SkillSidebarAccountFooter />
        </div>
      </aside>
      <FileSearchDialog
        files={files}
        open={searchDialogOpen}
        onOpenChange={setSearchDialogOpen}
        onSelect={onSelect}
      />
    </>
  )
}
