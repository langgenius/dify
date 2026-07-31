'use client'

import type {
  SkillDetailResponse,
  SkillFileResponse,
} from '@dify/contracts/api/console/workspaces/types.gen'
import type { DragEvent, FocusEvent, MouseEvent } from 'react'
import type { SkillDropOperation, SkillDropTarget } from './file-tree-dnd'
import type {
  FileTreeInlineAction,
  FileTreeNode,
  SkillFileClipboard,
  SkillFileMutationCoordinator,
  SkillUploadQueueItem,
} from './shared'
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
import {
  ScrollAreaContent,
  ScrollAreaRoot,
  ScrollAreaScrollbar,
  ScrollAreaThumb,
  ScrollAreaViewport,
} from '@langgenius/dify-ui/scroll-area'
import { toast } from '@langgenius/dify-ui/toast'
import { matchesKeyboardEvent, useHotkey } from '@tanstack/react-hotkeys'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useEffectEvent, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import SidebarLeftArrowIcon from '@/app/components/base/icons/src/vender/SidebarLeftArrowIcon'
import { DetailSidebarToggleButton } from '@/app/components/detail-sidebar/toggle-button'
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
import { SkillDisplayNameEditor } from './skill-display-name-editor'
import { SkillReferencesPanel, SkillTagsEditor } from './skill-metadata'

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
  collapsed: boolean
  detail: SkillDetailResponse | undefined
  fileMutationCoordinator: SkillFileMutationCoordinator
  files: SkillFileResponse[]
  onCollapsedChange: (collapsed: boolean) => void
  onSelect: (path: string, files?: SkillFileResponse[]) => void
  readonly: boolean
  selectedPath: string | undefined
  skillId: string
}) {
  const { t } = useTranslation('skill')
  const { t: tCommon } = useTranslation('common')
  const queryClient = useQueryClient()
  const referencesRegionRef = useRef<HTMLDivElement>(null)
  const uploadInputRef = useRef<HTMLInputElement>(null)
  const [inlineAction, setInlineAction] = useState<FileTreeInlineAction>()
  const [draggingPaths, setDraggingPaths] = useState<string[]>([])
  const [dropTarget, setDropTarget] = useState<SkillDropTarget>()
  const [collapsedFolderPaths, setCollapsedFolderPaths] = useState<string[]>([])
  const [referencesOpen, setReferencesOpen] = useState(false)
  const [searchDialogOpen, setSearchDialogOpen] = useState(false)
  const [selectedPaths, setSelectedPaths] = useState<string[]>([])
  const [selectionAnchorPath, setSelectionAnchorPath] = useState<string>()
  const [clipboard, setClipboard] = useState<SkillFileClipboard>()
  const [uploadItems, setUploadItems] = useState<SkillUploadQueueItem[]>([])
  const [deleteNode, setDeleteNode] = useState<FileTreeNode>()
  const activeUploadXhrRef = useRef<XMLHttpRequest | undefined>(undefined)
  const cancelUploadRef = useRef(false)
  const uploadBatchRef = useRef<
    | {
        files: File[]
        itemIds: string[]
        targetDirectory: string | undefined
      }
    | undefined
  >(undefined)

  const handleReferencesRegionBlur = useCallback((event: FocusEvent<HTMLDivElement>) => {
    const nextTarget = event.relatedTarget
    if (nextTarget instanceof Node && event.currentTarget.contains(nextTarget)) return
    setReferencesOpen(false)
  }, [])

  useEffect(() => {
    if (!referencesOpen) return

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target
      if (!(target instanceof Node)) return
      if (referencesRegionRef.current?.contains(target)) return
      setReferencesOpen(false)
    }

    document.addEventListener('pointerdown', handlePointerDown, true)
    return () => document.removeEventListener('pointerdown', handlePointerDown, true)
  }, [referencesOpen])

  const fileMutation = useMutation(
    consoleQuery.workspaces.current.skills.bySkillId.files.patch.mutationOptions({
      context: { silent: true },
    }),
  )
  const tree = toFileTree(files)
  const flatTree = flattenFileTree(tree)
  const isUploading = uploadItems.some(
    (item) => item.status === 'uploading' || item.status === 'saving',
  )
  const isMutating = fileMutation.isPending || isUploading
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
        mime_type: 'text/markdown',
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

    const nextUploadItems = filesToUpload.map((file, index) => ({
      id: createUploadItemId(file, index),
      name: getUploadFileName(file),
      progress: 0,
      status: 'uploading' as const,
    }))
    setUploadItems(nextUploadItems)
    uploadBatchRef.current = {
      files: filesToUpload,
      itemIds: nextUploadItems.map((item) => item.id),
      targetDirectory,
    }
    cancelUploadRef.current = false

    let latestDetail = detail
    let lastUploadedPath = ''
    let successCount = 0
    let failedCount = 0

    for (const [index, file] of filesToUpload.entries()) {
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

        const path = getUploadPath(file, targetDirectory)
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
        patchUploadItem(item.id, {
          error:
            (await getAsyncSkillErrorMessage(error)) ??
            t(($) => $['skillManagement.detail.uploadFileFailed']),
          progress: 100,
          status: 'failed',
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
    const batch = uploadBatchRef.current
    if (!batch) return

    const failedIds = new Set(
      uploadItems.filter((item) => item.status === 'failed').map((item) => item.id),
    )
    const failedFiles = batch.files.filter((_, index) => {
      const itemId = batch.itemIds[index]
      return itemId ? failedIds.has(itemId) : false
    })
    void handleUploadFiles(failedFiles, batch.targetDirectory)
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

      event.preventDefault()
      handleCut(shortcutTargetPath)
    },
    {
      enabled: fileShortcutEnabled,
      ignoreInputs: true,
      preventDefault: true,
      stopPropagation: true,
    },
  )
  useHotkey(
    skillFileHotkeys.copy.command,
    (event) => {
      if (!shortcutTargetPath) return

      event.preventDefault()
      handleCopy(shortcutTargetPath)
    },
    {
      enabled: fileShortcutEnabled,
      ignoreInputs: true,
      preventDefault: true,
      stopPropagation: true,
    },
  )

  const handleNativeCopy = useEffectEvent((event: ClipboardEvent) => {
    if (!fileShortcutEnabled || !shortcutTargetPath) return
    if (isEditableKeyboardTarget(event.target)) return

    event.preventDefault()
    handleCopy(shortcutTargetPath)
  })
  const handleNativeCut = useEffectEvent((event: ClipboardEvent) => {
    if (!fileShortcutEnabled || !shortcutTargetPath) return
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

  if (collapsed) {
    return (
      <aside className="flex w-10 shrink-0 flex-col items-center overflow-hidden border-r border-divider-subtle bg-background-default py-3">
        <button
          type="button"
          aria-label={t(($) => $['skillManagement.detail.expandSidebar'])}
          title={t(($) => $['skillManagement.detail.expandSidebar'])}
          className="flex size-7 cursor-pointer items-center justify-center rounded-md text-text-tertiary outline-hidden hover:bg-state-base-hover hover:text-text-secondary focus-visible:ring-2 focus-visible:ring-state-accent-solid"
          onClick={() => onCollapsedChange(false)}
        >
          <span aria-hidden className="i-ri-sidebar-unfold-line size-4" />
        </button>
      </aside>
    )
  }

  return (
    <>
      <aside
        data-testid="skill-detail-sidebar"
        className="flex w-[248px] shrink-0 flex-col overflow-visible bg-background-body p-1"
      >
        <div className="flex min-h-0 flex-1 flex-col overflow-visible rounded-lg bg-background-default">
          <div
            data-testid="skill-detail-sidebar-header"
            className="flex h-12 shrink-0 items-center py-2 pr-2 pl-1"
          >
            <div className="flex min-w-0 flex-1 items-center gap-px">
              <Link
                href="/"
                aria-label={tCommon(($) => $['mainNav.home'])}
                className="flex shrink-0 items-center rounded-lg py-2 pr-1.5 pl-0.5 text-text-tertiary outline-hidden transition-colors hover:bg-background-default-hover hover:text-text-secondary focus-visible:ring-2 focus-visible:ring-state-accent-solid"
              >
                <span aria-hidden className="i-ri-arrow-left-s-line size-4" />
                <span aria-hidden className="i-custom-vender-main-nav-app-home size-4" />
              </Link>
              <span className="w-[5px] shrink-0 system-md-regular text-text-quaternary">/</span>
              <Link
                href="/skills"
                className="w-14 shrink-0 truncate rounded-lg px-1.5 py-2 system-sm-semibold-uppercase text-text-secondary outline-hidden transition-colors hover:bg-background-default-hover hover:text-text-primary focus-visible:ring-2 focus-visible:ring-state-accent-solid"
              >
                <h1>SKILLS</h1>
              </Link>
            </div>
            <button
              type="button"
              aria-label={t(($) => $['skillManagement.detail.searchFiles'])}
              title={t(($) => $['skillManagement.detail.searchFiles'])}
              className="flex size-8 shrink-0 cursor-pointer items-center justify-center overflow-hidden rounded-[10px] text-text-tertiary outline-hidden transition-colors hover:bg-state-base-hover hover:text-text-secondary focus-visible:ring-2 focus-visible:ring-state-accent-solid"
              onClick={() => setSearchDialogOpen(true)}
            >
              <span aria-hidden className="i-custom-vender-main-nav-quick-search size-4" />
            </button>
            <DetailSidebarToggleButton
              expand
              onToggle={() => onCollapsedChange(true)}
              icon={<SidebarLeftArrowIcon aria-hidden className="size-4" />}
              className="size-8 rounded-[10px] border-0 bg-transparent px-0 text-text-tertiary shadow-none hover:border-0 hover:bg-state-base-hover hover:text-text-secondary"
            />
          </div>
          <div className="p-3">
            <div className="flex min-h-10 items-start gap-1 pt-0.5">
              <div className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-[10px] border-[0.5px] border-divider-regular bg-background-default">
                {detail?.icon ? (
                  <span className="system-md-medium text-text-secondary">{detail.icon}</span>
                ) : (
                  <span aria-hidden className="i-ri-box-3-line size-5 text-text-secondary" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                {detail ? (
                  <SkillDisplayNameEditor
                    detail={detail}
                    fileMutationCoordinator={fileMutationCoordinator}
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
              {t(($) => $['skillManagement.detail.fileCount'], { count: fileCount })}
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
          <ScrollAreaRoot className="relative min-h-0 flex-1 overflow-hidden">
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
                                inlineAction.nodeType === 'file' ? 'File name' : 'Folder name'
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
                            onSelect={onSelect}
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
                onRetry={handleRetryUpload}
              />
            )}
          </ScrollAreaRoot>
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
          <div className="mx-4 border-t border-divider-subtle py-3">
            <div ref={referencesRegionRef} onBlur={handleReferencesRegionBlur}>
              <button
                type="button"
                className="flex h-7 w-full cursor-pointer items-center gap-2 rounded-md text-left system-xs-regular text-text-tertiary outline-hidden hover:bg-state-base-hover hover:text-text-secondary focus-visible:ring-2 focus-visible:ring-state-accent-solid"
                aria-expanded={referencesOpen}
                onClick={() => setReferencesOpen((open) => !open)}
              >
                <span aria-hidden className="i-ri-apps-2-line size-4 shrink-0" />
                <span className="min-w-0 flex-1 truncate">
                  {t(($) => $['skillManagement.detail.referencedBy'], {
                    count: detail?.reference_count ?? 0,
                  })}
                </span>
                <span
                  aria-hidden
                  className={cn(
                    'i-ri-arrow-right-s-line size-4 text-text-quaternary transition-transform',
                    referencesOpen && 'rotate-90',
                  )}
                />
              </button>
              {referencesOpen && (
                <div className="relative z-20 mt-1">
                  <SkillReferencesPanel
                    referenceCount={detail?.reference_count ?? 0}
                    skillId={skillId}
                  />
                </div>
              )}
            </div>
            <div className="flex h-7 items-center gap-2 system-xs-regular text-text-tertiary">
              <span aria-hidden className="i-ri-account-circle-line size-4 shrink-0" />
              <span className="min-w-0 truncate">
                {t(($) => $['skillManagement.detail.createdBy'], {
                  name: detail?.created_by_name ?? detail?.created_by ?? '-',
                })}
              </span>
            </div>
          </div>
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
