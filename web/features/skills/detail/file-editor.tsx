'use client'

/* oxlint-disable eslint-react/set-state-in-effect -- Extracted editor owners intentionally mirror authoritative snapshots into local draft state. */

import type {
  SkillDetailResponse,
  SkillFileResponse,
  SkillVersionResponse,
} from '@dify/contracts/api/console/workspaces/types.gen'
import type { ChangeEvent, FormEvent, KeyboardEvent } from 'react'
import type { SkillFileMutationCoordinator } from './shared'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { toast } from '@langgenius/dify-ui/toast'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { SkeletonRectangle } from '@/app/components/base/skeleton'
import CodeEditor from '@/app/components/workflow/nodes/_base/components/editor/code-editor'
import { useFormatTimeFromNow } from '@/hooks/use-format-time-from-now'
import { consoleQuery } from '@/service/client'
import { downloadBlob } from '@/utils/download'
import { fetchSkillFileBlob } from '../client'
import { FileTabs } from './file-tabs'
import {
  CsvTablePreview,
  EditableMetadataEntry,
  EditableMetadataField,
  MarkdownBodyReferencePreview,
  MarkdownLiveBodyEditor,
  MarkdownModeSwitch,
  MarkdownSourceEditor,
  ReferenceFilesPicker,
  VersionActionBar,
} from './markdown-editor'
import { SkillPublishBar } from './publish-bar'
import {
  addMarkdownMetadata,
  findBrokenMarkdownReferenceRangeAtCaret,
  findFileByPath,
  findMarkdownReferenceRangeAtCaret,
  getAsyncSkillErrorPayload,
  getContentEditableCaretAnchor,
  getErrorCode,
  getErrorDetailNumber,
  getErrorDetailString,
  getMarkdownBodyPrefix,
  getMarkdownLiveEditorSelectionOffset,
  getPathBaseName,
  getPathDirName,
  getReferenceTargets,
  getReferenceText,
  getSkillCodeLanguage,
  getSkillFileIconClass,
  getTextareaCaretAnchor,
  insertMarkdownLiveEditorLineBreak,
  isCsvFile,
  isDirectory,
  isEditableMetadataKey,
  isMarkdownFile,
  isProtectedMarkdownMetadataKey,
  isSkillImageFile,
  isSkillPdfFile,
  isTextFile,
  metadataInputClassName,
  parseCsvRows,
  parseMarkdownContent,
  refreshSkillDetailAfterConflict,
  removeMarkdownMetadata,
  renderMarkdownLiveEditorContent,
  replaceMarkdownBody,
  runSkillFileMutation,
  serializeMarkdownLiveEditorNode,
  setMarkdownDisplayName,
  setMarkdownFrontmatterField,
  setMarkdownLiveEditorSelectionOffset,
  setSkillDetailCache,
  stripSkillFrontmatterForDisplay,
  updateMarkdownMetadata,
} from './shared'
import { SkillPublishConfirmPanel } from './skill-metadata'

export function FileEditor({
  detail,
  file,
  fileMutationCoordinator,
  hasLocalUnpublishedChanges,
  onLocalUnpublishedChangesChange,
  onPromoteFile,
  onOpenVersions,
  onPublish,
  onRestoreVersion,
  onExitVersion,
  onCloseFile,
  onDraftDetailChange,
  onSelectFile,
  openFiles,
  previewFilePath,
  publishing,
  readonly,
  selectedPath,
  selectedVersion,
  selectedVersionId,
  skillId,
}: {
  detail: SkillDetailResponse | undefined
  file: SkillFileResponse | undefined
  fileMutationCoordinator: SkillFileMutationCoordinator
  hasLocalUnpublishedChanges: boolean
  onLocalUnpublishedChangesChange: (hasChanges: boolean) => void
  onPromoteFile: (path: string) => void
  onOpenVersions: () => void
  onPublish: () => void
  onRestoreVersion: () => void
  onExitVersion: () => void
  onCloseFile: (path: string) => void
  onDraftDetailChange: (detail: SkillDetailResponse) => void
  onSelectFile: (path: string) => void
  openFiles: SkillFileResponse[]
  previewFilePath: string | undefined
  publishing: boolean
  readonly: boolean
  selectedPath: string | undefined
  selectedVersion: SkillVersionResponse | undefined
  selectedVersionId: string | null
  skillId: string
}) {
  const { t } = useTranslation('skill')
  const queryClient = useQueryClient()
  const { formatTimeFromNow } = useFormatTimeFromNow()
  const initialContent = file && isTextFile(file) ? (file.content ?? '') : ''
  const initialSavedAt = detail?.updated_at ? detail.updated_at * 1000 : undefined
  const [draftContent, setDraftContent] = useState(initialContent)
  const [markdownMode, setMarkdownMode] = useState<'live' | 'source'>('live')
  const [metadataAdding, setMetadataAdding] = useState(false)
  const [displayNameDraft, setDisplayNameDraft] = useState('')
  const [metadataKey, setMetadataKey] = useState('')
  const [metadataValue, setMetadataValue] = useState('')
  const [referencePicker, setReferencePicker] = useState<{
    anchor: { x: number; y: number }
    currentDirectory: string
    query: string
    slashIndex: number
  } | null>(null)
  const [publishConfirmOpen, setPublishConfirmOpen] = useState(false)
  const [referenceSelectedIndex, setReferenceSelectedIndex] = useState(0)
  const [saveStatus, setSaveStatus] = useState<'dirty' | 'error' | 'saved' | 'saving'>('saved')
  const [hasSaveConflict, setHasSaveConflict] = useState(false)
  const [savedAt, setSavedAt] = useState<number | undefined>(initialSavedAt)
  const [externalContentRevision, setExternalContentRevision] = useState(0)
  const draftContentRef = useRef(initialContent)
  const lastSavedContentRef = useRef(initialContent)
  const saveConflictContentRef = useRef<string | null>(null)
  const detailRef = useRef(detail)
  const fileRef = useRef(file)
  const pendingPublishAfterSaveRef = useRef(false)
  const metadataKeyInputRef = useRef<HTMLInputElement>(null)
  const pendingDisplayNameRenameRef = useRef(false)
  const liveBodyTextareaRef = useRef<HTMLTextAreaElement>(null)
  const liveBodyEditorRef = useRef<HTMLDivElement>(null)
  const sourceTextareaRef = useRef<HTMLTextAreaElement>(null)
  const { isPending: isSavingDraft, mutateAsync: saveDraftFile } = useMutation(
    consoleQuery.workspaces.current.skills.bySkillId.files.patch.mutationOptions({
      context: { silent: true },
    }),
  )
  const filePath = file?.path
  const codeLanguage = getSkillCodeLanguage(file)
  const isMarkdown = isMarkdownFile(file)
  const isSkillManifestFile = filePath === 'SKILL.md'
  const isCsv = isCsvFile(file)
  const markdownContent = useMemo(
    () =>
      isSkillManifestFile
        ? parseMarkdownContent(draftContent)
        : {
            body: stripSkillFrontmatterForDisplay(draftContent),
            description: '',
            displayName: '',
            metadata: [],
            name: '',
          },
    [draftContent, isSkillManifestFile],
  )
  const csvRows = useMemo(() => parseCsvRows(draftContent), [draftContent])
  const hasPublishedVersion = !!detail?.latest_published_version_id
  const latestPublishedAt = detail?.latest_published_at
  const hasUnpublishedChanges =
    displayNameDraft !== markdownContent.displayName ||
    saveStatus === 'dirty' ||
    saveStatus === 'saving' ||
    saveStatus === 'error' ||
    hasSaveConflict ||
    hasLocalUnpublishedChanges ||
    !hasPublishedVersion ||
    (typeof detail?.updated_at === 'number' &&
      typeof latestPublishedAt === 'number' &&
      detail.updated_at > latestPublishedAt)
  const publishState = publishing
    ? 'publishing'
    : !hasPublishedVersion
      ? 'draft'
      : hasUnpublishedChanges
        ? 'unpublished'
        : 'published'
  const publishDisabled = publishState === 'publishing' || publishState === 'published'
  const fileHash = file?.hash
  const editorInstanceKey = `${selectedVersionId ?? 'draft'}:${filePath ?? 'empty'}:${readonly ? 'readonly' : 'draft'}`
  const editorRenderKey = `${editorInstanceKey}:${externalContentRevision}`
  const referenceTargets = useMemo(
    () => getReferenceTargets(detail?.files ?? [], filePath),
    [detail?.files, filePath],
  )
  const showMarkdownMetadataPanel =
    isSkillManifestFile &&
    (markdownContent.name ||
      markdownContent.description ||
      markdownContent.displayName ||
      markdownContent.metadata.length > 0 ||
      !readonly)
  const referenceQuery = referencePicker?.query.trim().toLowerCase() ?? ''
  const filteredReferenceFiles = useMemo(() => {
    const currentDirectory = referencePicker?.currentDirectory ?? ''
    const scopedTargets = referenceTargets.filter((referenceFile) => {
      const parentDirectory = getPathDirName(referenceFile.path)
      return parentDirectory === currentDirectory
    })
    if (!referenceQuery) return scopedTargets

    return scopedTargets.filter((referenceFile) => {
      const path = referenceFile.path.toLowerCase()
      return path.includes(referenceQuery) || getPathBaseName(path).includes(referenceQuery)
    })
  }, [referencePicker?.currentDirectory, referenceQuery, referenceTargets])

  useEffect(() => {
    setDisplayNameDraft(markdownContent.displayName)
  }, [markdownContent.displayName])
  const shouldFetchTextFileContent = !!file && isTextFile(file) && file.content == null
  const textContentQuery = useQuery({
    queryKey: ['skill-file-text-content', skillId, selectedVersionId, filePath, fileHash],
    queryFn: async () => {
      if (!filePath) throw new Error('file path is required')
      const blob = await fetchSkillFileBlob({
        path: filePath,
        skillId,
        versionId: selectedVersionId,
      })
      return blob.text()
    },
    enabled: shouldFetchTextFileContent,
  })
  const isTextContentUnavailable = shouldFetchTextFileContent && textContentQuery.data == null
  const isTextContentPending = isTextContentUnavailable && textContentQuery.isPending
  const isTextContentError = isTextContentUnavailable && textContentQuery.isError
  const canEdit = !!file && isTextFile(file) && !readonly && !isTextContentUnavailable
  const canPreviewBinaryFile =
    !!file && !isTextFile(file) && (isSkillImageFile(file) || isSkillPdfFile(file))
  const binaryPreviewQuery = useQuery({
    queryKey: ['skill-file-blob-preview', skillId, selectedVersionId, filePath, fileHash],
    queryFn: () => {
      if (!filePath) throw new Error('file path is required')
      return fetchSkillFileBlob({
        path: filePath,
        skillId,
        versionId: selectedVersionId,
      })
    },
    enabled: canPreviewBinaryFile,
  })
  const fileObjectUrl = useMemo(
    () => (binaryPreviewQuery.data ? URL.createObjectURL(binaryPreviewQuery.data) : undefined),
    [binaryPreviewQuery.data],
  )
  const downloadMutation = useMutation({
    mutationFn: () => {
      if (!filePath) throw new Error('file path is required')
      return fetchSkillFileBlob({
        download: true,
        path: filePath,
        skillId,
        versionId: selectedVersionId,
      })
    },
    onSuccess: (blob) => {
      if (!file) return
      downloadBlob({ data: blob, fileName: getPathBaseName(file.path) })
    },
    onError: () => {
      toast.error(t(($) => $['skillManagement.detail.loadFailed']))
    },
  })

  const saveDraftContent = useCallback(
    async (content: string) => {
      const currentDetail = detailRef.current
      const currentFile = fileRef.current
      if (!currentDetail || !currentFile || !canEdit || isSavingDraft) return false
      if (saveConflictContentRef.current === content) {
        setHasSaveConflict(true)
        toast.error(t(($) => $['skillManagement.detail.saveConflict']))
        return false
      }

      setHasSaveConflict(false)
      setSaveStatus('saving')
      const shouldNotifyDisplayNameRename =
        currentFile.path === 'SKILL.md' && pendingDisplayNameRenameRef.current
      try {
        const nextCachedDetail = await runSkillFileMutation(
          fileMutationCoordinator,
          async (expectedUpdatedAt) =>
            saveDraftFile({
              params: {
                skill_id: skillId,
              },
              body: {
                content,
                expected_updated_at: expectedUpdatedAt,
                hash: currentFile.hash,
                mime_type: currentFile.mime_type,
                operation: 'upsert_text',
                path: currentFile.path,
                size: content.length,
              },
            }),
        )

        detailRef.current = nextCachedDetail
        fileRef.current =
          findFileByPath(nextCachedDetail.files ?? [], currentFile.path) ?? currentFile
        lastSavedContentRef.current = content
        saveConflictContentRef.current = null
        setHasSaveConflict(false)
        setSavedAt(nextCachedDetail.updated_at * 1000)
        setSaveStatus(draftContentRef.current === content ? 'saved' : 'dirty')
        setSkillDetailCache(queryClient, skillId, nextCachedDetail)
        onDraftDetailChange(nextCachedDetail)
        if (shouldNotifyDisplayNameRename) {
          pendingDisplayNameRenameRef.current = false
          toast.success(t(($) => $['skillManagement.detail.renameSkillSuccess']))
        }
        return true
      } catch (error) {
        const errorPayload = await getAsyncSkillErrorPayload(error)
        if (getErrorCode(errorPayload ?? error) === 'skill_conflict') {
          try {
            const currentUpdatedAt = getErrorDetailNumber(
              errorPayload ?? error,
              'current_updated_at',
            )
            const currentFileHash = getErrorDetailString(errorPayload ?? error, 'current_file_hash')
            const currentFileContent = getErrorDetailString(
              errorPayload ?? error,
              'current_file_content',
            )
            let latestDetail: SkillDetailResponse | undefined
            try {
              latestDetail = await refreshSkillDetailAfterConflict(queryClient, skillId)
            } catch {
              latestDetail = undefined
            }
            const refetchedDetail =
              latestDetail?.updated_at != null &&
              (currentUpdatedAt == null || latestDetail.updated_at >= currentUpdatedAt)
                ? latestDetail
                : undefined
            const latestUpdatedAt = refetchedDetail?.updated_at ?? currentUpdatedAt
            if (latestUpdatedAt == null) throw error
            const latestFile = refetchedDetail
              ? findFileByPath(refetchedDetail.files ?? [], currentFile.path)
              : undefined
            if (latestFile && isTextFile(latestFile) && latestFile.content != null)
              lastSavedContentRef.current = latestFile.content
            else if (currentFileContent != null) lastSavedContentRef.current = currentFileContent
            if (refetchedDetail) {
              detailRef.current = refetchedDetail
              fileMutationCoordinator.latestDetail = refetchedDetail
              fileRef.current = latestFile ?? currentFile
              setSkillDetailCache(queryClient, skillId, refetchedDetail)
              onDraftDetailChange(refetchedDetail)
            } else {
              const recoveredDetail = {
                ...currentDetail,
                updated_at: latestUpdatedAt,
              }
              detailRef.current = recoveredDetail
              fileMutationCoordinator.latestDetail = recoveredDetail
              fileRef.current = {
                ...currentFile,
                hash: currentFileHash ?? currentFile.hash,
              }
            }

            saveConflictContentRef.current =
              draftContentRef.current === lastSavedContentRef.current
                ? null
                : draftContentRef.current

            setHasSaveConflict(saveConflictContentRef.current != null)
            setSavedAt(latestUpdatedAt * 1000)
            setSaveStatus(
              draftContentRef.current === lastSavedContentRef.current ? 'saved' : 'dirty',
            )
            toast.error(t(($) => $['skillManagement.detail.saveConflict']))
            return false
          } catch {
            setSaveStatus('error')
            toast.error(t(($) => $['skillManagement.detail.saveFailed']))
            return false
          }
        }

        setSaveStatus('error')
        toast.error(t(($) => $['skillManagement.detail.saveFailed']))
        return false
      }
    },
    [
      canEdit,
      fileMutationCoordinator,
      isSavingDraft,
      onDraftDetailChange,
      queryClient,
      saveDraftFile,
      skillId,
      t,
    ],
  )
  const canEditRef = useRef(canEdit)
  const saveDraftContentRef = useRef(saveDraftContent)

  detailRef.current = detail
  fileRef.current = file
  canEditRef.current = canEdit

  useEffect(() => {
    const currentFile = fileRef.current
    const nextContent = currentFile && isTextFile(currentFile) ? (currentFile.content ?? '') : ''

    draftContentRef.current = nextContent
    lastSavedContentRef.current = nextContent
    saveConflictContentRef.current = null
    setHasSaveConflict(false)
    setDraftContent(nextContent)
    setSaveStatus('saved')
    setMetadataAdding(false)
    setMetadataKey('')
    setMetadataValue('')
    setReferencePicker(null)
    setExternalContentRevision(0)
  }, [editorInstanceKey])

  useEffect(() => {
    if (!file || !isTextFile(file) || file.content == null) return
    if (draftContentRef.current !== lastSavedContentRef.current) return
    if (file.content === lastSavedContentRef.current) return

    draftContentRef.current = file.content
    lastSavedContentRef.current = file.content
    saveConflictContentRef.current = null
    setHasSaveConflict(false)
    setDraftContent(file.content)
    setSavedAt(detail?.updated_at ? detail.updated_at * 1000 : undefined)
    setSaveStatus('saved')
    setExternalContentRevision((revision) => revision + 1)
  }, [detail?.updated_at, file, fileHash])

  useEffect(() => {
    if (!shouldFetchTextFileContent || textContentQuery.data == null) return
    if (draftContentRef.current !== lastSavedContentRef.current) return

    draftContentRef.current = textContentQuery.data
    lastSavedContentRef.current = textContentQuery.data
    saveConflictContentRef.current = null
    setHasSaveConflict(false)
    setDraftContent(textContentQuery.data)
    setSaveStatus('saved')
    setExternalContentRevision((revision) => revision + 1)
  }, [shouldFetchTextFileContent, textContentQuery.data])

  useEffect(() => {
    if (!canEdit) return
    if (draftContent === lastSavedContentRef.current) return
    if (draftContent === saveConflictContentRef.current) return
    if (saveStatus === 'saving') return

    const timer = window.setTimeout(() => {
      void saveDraftContent(draftContent)
    }, 1000)

    return () => window.clearTimeout(timer)
  }, [canEdit, draftContent, saveDraftContent, saveStatus])

  useEffect(() => {
    saveDraftContentRef.current = saveDraftContent
  }, [saveDraftContent])

  useEffect(() => {
    return () => {
      if (!canEditRef.current) return
      if (draftContentRef.current === lastSavedContentRef.current) return

      void saveDraftContentRef.current(draftContentRef.current)
    }
  }, [])

  useEffect(() => {
    return () => {
      if (fileObjectUrl) URL.revokeObjectURL(fileObjectUrl)
    }
  }, [fileObjectUrl])

  useEffect(() => {
    if (referencePicker?.query == null) return
    setReferenceSelectedIndex(0)
  }, [referencePicker?.currentDirectory, referencePicker?.query])

  useEffect(() => {
    if (referenceSelectedIndex < filteredReferenceFiles.length) return
    setReferenceSelectedIndex(Math.max(filteredReferenceFiles.length - 1, 0))
  }, [filteredReferenceFiles.length, referenceSelectedIndex])

  const updateDraftContent = useCallback(
    (nextContent: string) => {
      draftContentRef.current = nextContent
      const isConflictContent = nextContent === saveConflictContentRef.current
      if (!isConflictContent) {
        saveConflictContentRef.current = null
        setHasSaveConflict(false)
      }
      setDraftContent(nextContent)
      setSaveStatus(nextContent === lastSavedContentRef.current ? 'saved' : 'dirty')
      if (nextContent !== lastSavedContentRef.current) {
        onLocalUnpublishedChangesChange(true)
        if (filePath) onPromoteFile(filePath)
      }
    },
    [filePath, onLocalUnpublishedChangesChange, onPromoteFile],
  )

  const handleContentChange = (event: ChangeEvent<HTMLTextAreaElement>) => {
    const nextContent = event.target.value
    updateDraftContent(nextContent)

    if (!referencePicker) return

    const caretIndex = event.target.selectionStart
    if (
      caretIndex <= referencePicker.slashIndex ||
      nextContent[referencePicker.slashIndex] !== '/' ||
      nextContent.slice(referencePicker.slashIndex + 1, caretIndex).includes('\n')
    ) {
      setReferencePicker(null)
      return
    }

    setReferencePicker({
      anchor: getTextareaCaretAnchor(event.target, caretIndex),
      currentDirectory: referencePicker.currentDirectory,
      slashIndex: referencePicker.slashIndex,
      query: nextContent.slice(referencePicker.slashIndex + 1, caretIndex),
    })
  }

  const handleLiveBodyEditorInput = (event: FormEvent<HTMLDivElement>) => {
    const nextBody = serializeMarkdownLiveEditorNode(event.currentTarget).replace(/\u00A0/g, ' ')
    const nextCaretOffset = getMarkdownLiveEditorSelectionOffset(event.currentTarget)
    const nextContent = replaceMarkdownBody(draftContentRef.current, nextBody)
    updateDraftContent(nextContent)
    if (nextCaretOffset != null) {
      window.requestAnimationFrame(() => {
        if (!liveBodyEditorRef.current) return

        liveBodyEditorRef.current.focus()
        setMarkdownLiveEditorSelectionOffset(liveBodyEditorRef.current, nextCaretOffset)
      })
    }

    if (!referencePicker) return

    const bodyPrefixLength = getMarkdownBodyPrefix(nextContent).length
    const bodyCaretIndex = getMarkdownLiveEditorSelectionOffset(event.currentTarget) ?? 0
    const caretIndex = bodyPrefixLength + bodyCaretIndex
    if (
      caretIndex <= referencePicker.slashIndex ||
      nextContent[referencePicker.slashIndex] !== '/' ||
      nextContent.slice(referencePicker.slashIndex + 1, caretIndex).includes('\n')
    ) {
      setReferencePicker(null)
      return
    }

    setReferencePicker({
      anchor: getContentEditableCaretAnchor(event.currentTarget),
      currentDirectory: referencePicker.currentDirectory,
      slashIndex: referencePicker.slashIndex,
      query: nextContent.slice(referencePicker.slashIndex + 1, caretIndex),
    })
  }

  const handleReferenceDirectoryBack = () => {
    if (!referencePicker?.currentDirectory) return

    setReferencePicker({
      anchor: referencePicker.anchor,
      currentDirectory: getPathDirName(referencePicker.currentDirectory),
      slashIndex: referencePicker.slashIndex,
      query: '',
    })
  }

  const handleReferenceDirectoryOpen = (directory: SkillFileResponse) => {
    if (!referencePicker || !isDirectory(directory)) return

    setReferencePicker({
      anchor: referencePicker.anchor,
      currentDirectory: directory.path,
      slashIndex: referencePicker.slashIndex,
      query: '',
    })
  }

  const handleTextEditorKeyDown = (
    event: KeyboardEvent<HTMLDivElement | HTMLTextAreaElement>,
    bodyMode = false,
  ) => {
    if (!isMarkdown || readonly) return

    if (
      bodyMode &&
      event.currentTarget instanceof HTMLTextAreaElement &&
      event.key === 'Backspace' &&
      !event.metaKey &&
      !event.ctrlKey &&
      !event.altKey &&
      event.currentTarget.selectionStart === event.currentTarget.selectionEnd
    ) {
      const caretIndex = event.currentTarget.selectionStart
      if (event.currentTarget.value[caretIndex - 1] === '\n') {
        event.preventDefault()

        const nextCaretIndex = caretIndex - 1
        const nextBody = `${event.currentTarget.value.slice(0, nextCaretIndex)}${event.currentTarget.value.slice(caretIndex)}`
        const nextContent = replaceMarkdownBody(draftContentRef.current, nextBody)
        updateDraftContent(nextContent)
        window.requestAnimationFrame(() => {
          liveBodyTextareaRef.current?.focus()
          liveBodyTextareaRef.current?.setSelectionRange(nextCaretIndex, nextCaretIndex)
        })
        return
      }

      const referenceRange =
        findMarkdownReferenceRangeAtCaret(event.currentTarget.value, caretIndex) ??
        findBrokenMarkdownReferenceRangeAtCaret(event.currentTarget.value, caretIndex)
      if (referenceRange) {
        event.preventDefault()

        const nextBody = `${event.currentTarget.value.slice(0, referenceRange.start)}${event.currentTarget.value.slice(referenceRange.end)}`
        const nextContent = replaceMarkdownBody(draftContentRef.current, nextBody)
        updateDraftContent(nextContent)
        window.requestAnimationFrame(() => {
          liveBodyTextareaRef.current?.focus()
          liveBodyTextareaRef.current?.setSelectionRange(referenceRange.start, referenceRange.start)
        })
        return
      }
    }

    if (referencePicker) {
      if (event.key === 'Escape') {
        event.preventDefault()
        setReferencePicker(null)
        return
      }

      if (event.key === 'ArrowDown') {
        event.preventDefault()
        setReferenceSelectedIndex((index) =>
          Math.min(index + 1, Math.max(filteredReferenceFiles.length - 1, 0)),
        )
        return
      }

      if (event.key === 'ArrowUp') {
        event.preventDefault()
        if (referenceSelectedIndex === 0 && referencePicker.currentDirectory) {
          handleReferenceDirectoryBack()
          return
        }
        setReferenceSelectedIndex((index) => Math.max(index - 1, 0))
        return
      }

      if (event.key === 'ArrowLeft') {
        event.preventDefault()
        handleReferenceDirectoryBack()
        return
      }

      if (event.key === 'ArrowRight') {
        const selectedFile = filteredReferenceFiles[referenceSelectedIndex]
        if (!selectedFile || !isDirectory(selectedFile)) return

        event.preventDefault()
        handleReferenceDirectoryOpen(selectedFile)
        return
      }

      if (event.key === 'Enter') {
        const selectedFile = filteredReferenceFiles[referenceSelectedIndex]
        if (!selectedFile) return

        event.preventDefault()
        if (isDirectory(selectedFile)) {
          handleReferenceDirectoryOpen(selectedFile)
          return
        }

        // oxlint-disable-next-line typescript/no-use-before-define -- Reference insertion reads current picker state and is kept beside its write logic.
        handleInsertReferenceFile(selectedFile, bodyMode)
        return
      }
    }

    if (
      bodyMode &&
      event.currentTarget instanceof HTMLDivElement &&
      event.key === 'Enter' &&
      !event.metaKey &&
      !event.ctrlKey &&
      !event.altKey
    ) {
      event.preventDefault()

      const nextCaretOffset = insertMarkdownLiveEditorLineBreak(event.currentTarget)
      if (nextCaretOffset == null) return

      const nextBody = serializeMarkdownLiveEditorNode(event.currentTarget).replace(/\u00A0/g, ' ')
      const nextContent = replaceMarkdownBody(draftContentRef.current, nextBody)
      updateDraftContent(nextContent)
      window.requestAnimationFrame(() => {
        if (!liveBodyEditorRef.current) return

        liveBodyEditorRef.current.focus()
        setMarkdownLiveEditorSelectionOffset(liveBodyEditorRef.current, nextCaretOffset)
      })
      return
    }

    if (event.key !== '/' || event.metaKey || event.ctrlKey || event.altKey) return

    const bodyPrefixLength = bodyMode ? getMarkdownBodyPrefix(draftContentRef.current).length : 0
    const bodySelectionStart =
      event.currentTarget instanceof HTMLTextAreaElement
        ? event.currentTarget.selectionStart
        : getMarkdownLiveEditorSelectionOffset(event.currentTarget)
    if (bodySelectionStart == null) return

    setReferencePicker({
      anchor:
        event.currentTarget instanceof HTMLTextAreaElement
          ? getTextareaCaretAnchor(event.currentTarget, bodySelectionStart)
          : getContentEditableCaretAnchor(event.currentTarget),
      currentDirectory: '',
      slashIndex: bodyPrefixLength + bodySelectionStart,
      query: '',
    })
    setReferenceSelectedIndex(0)
  }

  const handleInsertReferenceFile = (referenceFile: SkillFileResponse, bodyMode = false) => {
    if (!referencePicker) return

    if (bodyMode && liveBodyEditorRef.current) {
      const bodyPrefixLength = getMarkdownBodyPrefix(draftContentRef.current).length
      const bodyCaretIndex =
        getMarkdownLiveEditorSelectionOffset(liveBodyEditorRef.current) ??
        referencePicker.slashIndex - bodyPrefixLength + referencePicker.query.length + 1
      const replaceEnd = bodyPrefixLength + bodyCaretIndex
      const referenceText = `${getReferenceText(referenceFile)}\n`
      const nextContent = `${draftContentRef.current.slice(0, referencePicker.slashIndex)}${referenceText}${draftContentRef.current.slice(replaceEnd)}`
      const nextBody = nextContent.slice(bodyPrefixLength)

      updateDraftContent(nextContent)
      setReferencePicker(null)
      window.requestAnimationFrame(() => {
        const editor = liveBodyEditorRef.current
        if (!editor) return

        renderMarkdownLiveEditorContent(editor, nextBody)
        editor.focus()
        setMarkdownLiveEditorSelectionOffset(
          editor,
          referencePicker.slashIndex - bodyPrefixLength + referenceText.length,
        )
      })
      return
    }

    const textarea = bodyMode ? liveBodyTextareaRef.current : sourceTextareaRef.current
    const bodyPrefixLength = bodyMode ? getMarkdownBodyPrefix(draftContentRef.current).length : 0
    const replaceEnd =
      (textarea?.selectionStart ?? referencePicker.slashIndex + referencePicker.query.length + 1) +
      bodyPrefixLength
    const referenceText = bodyMode
      ? `${getReferenceText(referenceFile)}\n`
      : getReferenceText(referenceFile)
    const nextContent = `${draftContentRef.current.slice(0, referencePicker.slashIndex)}${referenceText}${draftContentRef.current.slice(replaceEnd)}`
    const nextCaretIndex = referencePicker.slashIndex + referenceText.length
    const textareaCaretIndex = bodyMode ? nextCaretIndex - bodyPrefixLength : nextCaretIndex

    updateDraftContent(nextContent)
    setReferencePicker(null)
    window.requestAnimationFrame(() => {
      textarea?.focus()
      textarea?.setSelectionRange(textareaCaretIndex, textareaCaretIndex)
    })
  }

  const trimmedMetadataKey = metadataKey.trim()
  const canAddMetadata =
    isSkillManifestFile &&
    isEditableMetadataKey(trimmedMetadataKey) &&
    !isProtectedMarkdownMetadataKey(trimmedMetadataKey)

  const handleAddMetadata = () => {
    if (!isSkillManifestFile || !canAddMetadata) return

    updateDraftContent(
      addMarkdownMetadata(draftContentRef.current, trimmedMetadataKey, metadataValue),
    )
    setMetadataKey('')
    setMetadataValue('')
    setMetadataAdding(false)
  }

  const handleDisplayNameCommit = () => {
    if (!isSkillManifestFile || readonly || displayNameDraft === markdownContent.displayName) return

    pendingDisplayNameRenameRef.current = true
    updateDraftContent(setMarkdownDisplayName(draftContentRef.current, displayNameDraft))
  }

  const handleRemoveMetadata = (key: string) => {
    if (!isSkillManifestFile) return

    updateDraftContent(removeMarkdownMetadata(draftContentRef.current, key))
  }

  const handleCancelAddMetadata = () => {
    setMetadataKey('')
    setMetadataValue('')
    setMetadataAdding(false)
  }

  const handlePublish = useCallback(async () => {
    if (publishDisabled) return
    if (saveStatus === 'saving') {
      pendingPublishAfterSaveRef.current = true
      return
    }

    let contentToPublish = draftContentRef.current
    if (canEdit && isSkillManifestFile && displayNameDraft !== markdownContent.displayName) {
      contentToPublish = setMarkdownDisplayName(contentToPublish, displayNameDraft)
      updateDraftContent(contentToPublish)
    }

    if (canEdit && contentToPublish !== lastSavedContentRef.current) {
      const saved = await saveDraftContent(contentToPublish)
      if (!saved) return
    }

    if ((detail?.reference_count ?? 0) > 0) {
      setPublishConfirmOpen(true)
      return
    }

    onPublish()
  }, [
    canEdit,
    detail?.reference_count,
    displayNameDraft,
    isSkillManifestFile,
    markdownContent.displayName,
    onPublish,
    publishDisabled,
    saveDraftContent,
    saveStatus,
    updateDraftContent,
  ])

  useEffect(() => {
    if (!pendingPublishAfterSaveRef.current || saveStatus === 'saving') return

    pendingPublishAfterSaveRef.current = false
    void handlePublish()
  }, [handlePublish, saveStatus])

  const saveStateText =
    saveStatus === 'saving'
      ? t(($) => $['skillManagement.detail.saving'])
      : hasSaveConflict
        ? t(($) => $['skillManagement.detail.saveConflictStatus'])
        : saveStatus === 'dirty'
          ? t(($) => $['skillManagement.detail.unsavedChanges'])
          : saveStatus === 'error'
            ? t(($) => $['skillManagement.detail.saveFailed'])
            : savedAt
              ? t(($) => $['skillManagement.detail.savedAt'], { time: formatTimeFromNow(savedAt) })
              : t(($) => $['skillManagement.detail.saved'])
  const publishMetaText =
    publishState === 'published'
      ? latestPublishedAt
        ? t(($) => $['skillManagement.detail.publishedAt'], {
            time: formatTimeFromNow(latestPublishedAt * 1000),
          })
        : t(($) => $['skillManagement.detail.published'])
      : saveStateText

  if (!selectedPath) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center p-6">
        <p className="system-sm-regular text-text-tertiary">
          {t(($) => $['skillManagement.detail.noFileSelected'])}
        </p>
      </div>
    )
  }

  if (!file) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center p-6">
        <p className="system-sm-regular text-text-tertiary">
          {t(($) => $['skillManagement.detail.fileMissing'])}
        </p>
      </div>
    )
  }

  return (
    <main className="relative my-1 mr-1 flex min-w-0 flex-1 flex-col overflow-hidden rounded-lg bg-background-default inset-ring-[0.5px] inset-ring-divider-subtle">
      <FileTabs
        files={openFiles}
        onClose={onCloseFile}
        onSelect={onSelectFile}
        previewPath={previewFilePath}
        selectedPath={selectedPath}
      />
      <div className="mt-px min-h-0 flex-1">
        {isTextContentPending ? (
          <div aria-busy="true" className="h-full cursor-not-allowed" />
        ) : isTextContentError ? (
          <div className="flex h-full items-center justify-center rounded-lg border border-dashed border-divider-regular bg-background-default">
            <p className="system-sm-regular text-text-tertiary">
              {t(($) => $['skillManagement.detail.loadFailed'])}
            </p>
          </div>
        ) : isMarkdown && markdownMode === 'live' ? (
          <div className="relative h-full overflow-hidden bg-background-default">
            <MarkdownModeSwitch mode={markdownMode} onChange={setMarkdownMode} />
            <div className="h-full scrollbar-none overflow-y-auto px-12 py-8">
              <div className="mx-auto max-w-[768px]">
                {showMarkdownMetadataPanel && (
                  <div className="mb-3 flex flex-col gap-3 p-2">
                    {(markdownContent.name || !readonly) && (
                      <EditableMetadataField
                        label="name"
                        value={markdownContent.name}
                        valuePlaceholder={t(
                          ($) => $['skillManagement.detail.skillNamePlaceholder'],
                        )}
                        readOnly={readonly}
                        onValueChange={
                          readonly
                            ? undefined
                            : (value) =>
                                updateDraftContent(
                                  setMarkdownFrontmatterField(
                                    draftContentRef.current,
                                    'name',
                                    value,
                                  ),
                                )
                        }
                      />
                    )}
                    {(markdownContent.description || !readonly) && (
                      <EditableMetadataField
                        label="description"
                        value={markdownContent.description}
                        valuePlaceholder={t(
                          ($) => $['skillManagement.detail.skillDescriptionPlaceholder'],
                        )}
                        multiline
                        readOnly={readonly}
                        onValueChange={
                          readonly
                            ? undefined
                            : (value) =>
                                updateDraftContent(
                                  setMarkdownFrontmatterField(
                                    draftContentRef.current,
                                    'description',
                                    value,
                                  ),
                                )
                        }
                      />
                    )}
                    {(markdownContent.displayName || !readonly) && (
                      <EditableMetadataField
                        label="display-name"
                        value={displayNameDraft}
                        valuePlaceholder={detail?.display_name ?? ''}
                        readOnly={readonly}
                        onBlurCapture={handleDisplayNameCommit}
                        onValueChange={readonly ? undefined : setDisplayNameDraft}
                      />
                    )}
                    {markdownContent.metadata.map((entry) => {
                      const removable = !readonly && !isProtectedMarkdownMetadataKey(entry.key)

                      return readonly || !removable ? (
                        <EditableMetadataField
                          key={entry.key}
                          label={entry.key}
                          value={entry.value}
                          multiline
                          readOnly
                        />
                      ) : (
                        <EditableMetadataEntry
                          key={entry.key}
                          entryKey={entry.key}
                          value={entry.value}
                          onCommit={(previousKey, nextKey, nextValue) => {
                            updateDraftContent(
                              updateMarkdownMetadata(
                                draftContentRef.current,
                                previousKey,
                                nextKey,
                                nextValue,
                              ),
                            )
                          }}
                          onRemove={() => handleRemoveMetadata(entry.key)}
                        />
                      )
                    })}
                    {!readonly && metadataAdding && (
                      <div className="w-full space-y-0.5">
                        <div className="flex h-6 items-center gap-1">
                          <input
                            ref={metadataKeyInputRef}
                            value={metadataKey}
                            placeholder={t(($) => $['skillManagement.detail.metadataKey'])}
                            className={metadataInputClassName}
                            onChange={(event) => setMetadataKey(event.target.value)}
                            onKeyDown={(event) => {
                              if (event.key === 'Escape') handleCancelAddMetadata()
                            }}
                          />
                          <button
                            type="button"
                            aria-label={t(($) => $['skillManagement.detail.cancelAddMetadata'])}
                            className="flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-md text-text-quaternary outline-hidden hover:bg-state-base-hover hover:text-text-secondary focus-visible:ring-2 focus-visible:ring-state-accent-solid"
                            onClick={handleCancelAddMetadata}
                          >
                            <span aria-hidden className="i-ri-delete-bin-line size-4" />
                          </button>
                        </div>
                        <input
                          value={metadataValue}
                          placeholder={t(($) => $['skillManagement.detail.metadataValue'])}
                          className={metadataInputClassName}
                          onChange={(event) => setMetadataValue(event.target.value)}
                          onKeyDown={(event) => {
                            if (event.key === 'Escape') {
                              handleCancelAddMetadata()
                              return
                            }
                            if (event.key === 'Enter') {
                              event.preventDefault()
                              event.stopPropagation()
                            }
                          }}
                          onKeyUp={(event) => {
                            if (event.key !== 'Enter') return

                            event.preventDefault()
                            event.stopPropagation()
                            handleAddMetadata()
                          }}
                        />
                      </div>
                    )}
                    {!readonly && !metadataAdding && (
                      <div className="flex flex-col items-start px-1">
                        <button
                          type="button"
                          className="flex h-6 shrink-0 cursor-pointer items-center justify-center gap-px overflow-hidden rounded-md border-[0.5px] border-components-button-secondary-border bg-components-button-secondary-bg px-1.5 system-xs-medium text-components-button-secondary-text shadow-xs outline-hidden backdrop-blur-[5px] hover:border-components-button-secondary-border-hover hover:bg-components-button-secondary-bg-hover focus-visible:ring-2 focus-visible:ring-state-accent-solid"
                          onClick={() => {
                            setMetadataAdding(true)
                            window.requestAnimationFrame(() => metadataKeyInputRef.current?.focus())
                          }}
                        >
                          <span aria-hidden className="i-ri-add-line size-3.5" />
                          <span className="px-[3px]">
                            {t(($) => $['skillManagement.detail.addMetadata'])}
                          </span>
                        </button>
                      </div>
                    )}
                  </div>
                )}
                <div
                  className={cn(
                    'px-3 py-2',
                    showMarkdownMetadataPanel && 'border-t border-divider-subtle pt-5',
                  )}
                >
                  {readonly ? (
                    <MarkdownBodyReferencePreview
                      body={markdownContent.body}
                      className="min-h-[360px]"
                      onOpenReference={onSelectFile}
                      placeholder={t(
                        ($) => $['skillManagement.detail.referenceFiles.livePlaceholder'],
                      )}
                    />
                  ) : (
                    <div className="relative min-h-[360px]">
                      <MarkdownLiveBodyEditor
                        body={markdownContent.body}
                        contentRevision={externalContentRevision}
                        editorRef={liveBodyEditorRef}
                        onOpenReference={onSelectFile}
                        placeholder={t(
                          ($) => $['skillManagement.detail.referenceFiles.livePlaceholder'],
                        )}
                        onInput={handleLiveBodyEditorInput}
                        onKeyDown={(event) => handleTextEditorKeyDown(event, true)}
                      />
                    </div>
                  )}
                </div>
              </div>
            </div>
            {referencePicker && (
              <ReferenceFilesPicker
                files={filteredReferenceFiles}
                query={referenceQuery}
                selectedIndex={referenceSelectedIndex}
                title={t(($) => $['skillManagement.detail.referenceFiles.title'])}
                emptyText={t(($) => $['skillManagement.detail.referenceFiles.empty'])}
                navigateText={t(($) => $['skillManagement.detail.referenceFiles.navigate'])}
                confirmText={t(($) => $['skillManagement.detail.referenceFiles.confirm'])}
                currentDirectory={referencePicker.currentDirectory}
                anchor={referencePicker.anchor}
                onBack={handleReferenceDirectoryBack}
                onSelectIndex={setReferenceSelectedIndex}
                onSelect={(referenceFile) => {
                  if (isDirectory(referenceFile)) {
                    handleReferenceDirectoryOpen(referenceFile)
                    return
                  }

                  handleInsertReferenceFile(referenceFile, true)
                }}
              />
            )}
          </div>
        ) : isMarkdown ? (
          <div className="relative h-full overflow-hidden bg-background-default">
            <MarkdownModeSwitch mode={markdownMode} onChange={setMarkdownMode} />
            <MarkdownSourceEditor
              key={editorRenderKey}
              editorRef={sourceTextareaRef}
              readOnly={readonly}
              value={draftContent}
              placeholder={t(($) => $['skillManagement.detail.referenceFiles.livePlaceholder'])}
              onChange={handleContentChange}
              onKeyDown={(event) => handleTextEditorKeyDown(event)}
            />
            {referencePicker && (
              <ReferenceFilesPicker
                files={filteredReferenceFiles}
                query={referenceQuery}
                selectedIndex={referenceSelectedIndex}
                title={t(($) => $['skillManagement.detail.referenceFiles.title'])}
                emptyText={t(($) => $['skillManagement.detail.referenceFiles.empty'])}
                navigateText={t(($) => $['skillManagement.detail.referenceFiles.navigate'])}
                confirmText={t(($) => $['skillManagement.detail.referenceFiles.confirm'])}
                currentDirectory={referencePicker.currentDirectory}
                anchor={referencePicker.anchor}
                onBack={handleReferenceDirectoryBack}
                onSelectIndex={setReferenceSelectedIndex}
                onSelect={(referenceFile) => {
                  if (isDirectory(referenceFile)) {
                    handleReferenceDirectoryOpen(referenceFile)
                    return
                  }

                  handleInsertReferenceFile(referenceFile)
                }}
              />
            )}
          </div>
        ) : codeLanguage ? (
          <div className="h-full overflow-hidden rounded-xl border border-divider-regular bg-background-default">
            <CodeEditor
              key={editorRenderKey}
              language={codeLanguage}
              value={draftContent}
              readOnly={readonly}
              noWrapper
              isExpand
              className="h-full"
              onChange={updateDraftContent}
            />
          </div>
        ) : isCsv ? (
          <CsvTablePreview rows={csvRows} />
        ) : isTextFile(file) ? (
          <div className="relative h-full">
            <textarea
              ref={sourceTextareaRef}
              key={editorRenderKey}
              readOnly={readonly}
              value={draftContent}
              spellCheck={false}
              className={cn(
                'h-full w-full resize-none rounded-xl border border-divider-regular bg-background-default p-4 font-mono text-[13px]/[20px] text-text-secondary outline-hidden read-only:bg-background-section',
              )}
              onChange={handleContentChange}
              onKeyDown={(event) => handleTextEditorKeyDown(event)}
            />
            {referencePicker && (
              <ReferenceFilesPicker
                files={filteredReferenceFiles}
                query={referenceQuery}
                selectedIndex={referenceSelectedIndex}
                title={t(($) => $['skillManagement.detail.referenceFiles.title'])}
                emptyText={t(($) => $['skillManagement.detail.referenceFiles.empty'])}
                navigateText={t(($) => $['skillManagement.detail.referenceFiles.navigate'])}
                confirmText={t(($) => $['skillManagement.detail.referenceFiles.confirm'])}
                currentDirectory={referencePicker.currentDirectory}
                anchor={referencePicker.anchor}
                onBack={handleReferenceDirectoryBack}
                onSelectIndex={setReferenceSelectedIndex}
                onSelect={(referenceFile) => {
                  if (isDirectory(referenceFile)) {
                    handleReferenceDirectoryOpen(referenceFile)
                    return
                  }

                  handleInsertReferenceFile(referenceFile)
                }}
              />
            )}
          </div>
        ) : canPreviewBinaryFile && binaryPreviewQuery.isPending ? (
          <div className="flex h-full items-center justify-center rounded-lg border border-divider-regular bg-background-default">
            <SkeletonRectangle className="h-full w-full rounded-lg" />
          </div>
        ) : canPreviewBinaryFile && binaryPreviewQuery.isError ? (
          <div className="flex h-full items-center justify-center rounded-lg border border-dashed border-divider-regular bg-background-default">
            <p className="system-sm-regular text-text-tertiary">
              {t(($) => $['skillManagement.detail.loadFailed'])}
            </p>
          </div>
        ) : isSkillImageFile(file) && fileObjectUrl ? (
          <div className="flex h-full items-center justify-center overflow-hidden rounded-xl border border-divider-regular bg-background-section p-4">
            <img
              src={fileObjectUrl}
              alt={file.path}
              className="max-h-full max-w-full rounded-lg object-contain"
            />
          </div>
        ) : isSkillPdfFile(file) && fileObjectUrl ? (
          <iframe
            src={fileObjectUrl}
            title={file.path}
            className="h-full w-full rounded-xl border border-divider-regular bg-background-default"
          />
        ) : (
          <div className="flex h-full items-center justify-center rounded-lg border border-dashed border-divider-regular bg-background-default">
            <div className="flex flex-col items-center gap-2 text-center">
              <span aria-hidden className={cn('size-8', getSkillFileIconClass(file))} />
              <p className="system-sm-regular text-text-tertiary">
                {t(($) => $['skillManagement.detail.previewUnsupported'])}
              </p>
              <p className="system-xs-regular text-text-quaternary">
                {t(($) => $['skillManagement.detail.fileMeta'], {
                  size: file.size ?? 0,
                  type: file.mime_type ?? file.kind,
                })}
              </p>
              <Button
                variant="secondary"
                className="mt-2 h-8 px-3"
                loading={downloadMutation.isPending}
                onClick={() => downloadMutation.mutate()}
              >
                <span aria-hidden className="i-ri-download-line size-4" />
                {t(($) => $['skillManagement.detail.downloadFile'])}
              </Button>
            </div>
          </div>
        )}
      </div>
      {!readonly && (
        <div className="pointer-events-none absolute inset-x-0 bottom-3 flex justify-center px-4">
          <SkillPublishBar
            metaLabel={publishMetaText}
            onOpenVersions={onOpenVersions}
            onPublish={handlePublish}
            state={publishState}
          >
            <SkillPublishConfirmPanel
              loading={publishing}
              onCancel={() => setPublishConfirmOpen(false)}
              onConfirm={() => {
                setPublishConfirmOpen(false)
                onPublish()
              }}
              open={publishConfirmOpen}
              referenceCount={detail?.reference_count ?? 0}
              skillId={skillId}
            />
          </SkillPublishBar>
        </div>
      )}
      {readonly && selectedVersion && (
        <VersionActionBar
          version={selectedVersion}
          restoring={publishing}
          onRestore={onRestoreVersion}
          onExit={onExitVersion}
        />
      )}
    </main>
  )
}
