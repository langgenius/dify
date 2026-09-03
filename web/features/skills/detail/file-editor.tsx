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
import dynamic from '@/next/dynamic'
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
import { SkillPublishBar, SkillPublishBottomActions } from './publish-bar'
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
  metadataKeyInputClassName,
  metadataValueInputClassName,
  normalizeSkillDraftContentForEditing,
  parseCsvRows,
  parseMarkdownContent,
  refreshSkillDetailAfterConflict,
  removeMarkdownMetadata,
  renderMarkdownLiveEditorContent,
  replaceMarkdownBody,
  runSkillFileMutation,
  serializeMarkdownLiveEditorNode,
  setMarkdownFrontmatterField,
  setMarkdownLiveEditorSelectionOffset,
  setSkillDetailCache,
  stripSkillFrontmatterForDisplay,
  updateMarkdownMetadata,
} from './shared'
import { SkillPublishConfirmPanel } from './skill-metadata'

const SkillPdfPreview = dynamic(
  () => import('./skill-pdf-preview').then((module) => module.SkillPdfPreview),
  { ssr: false },
)

export function FileEditor({
  canPublish,
  detail,
  file,
  fileMutationCoordinator,
  hasLocalUnpublishedChanges,
  onLocalUnpublishedChangesChange,
  onPromoteFile,
  onOpenBuilder,
  onOpenVersions,
  onPublish,
  onRestoreVersion,
  onExitVersion,
  onCloseFile,
  onDraftDetailChange,
  onSaveConflictConfirm,
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
  canPublish: boolean
  detail: SkillDetailResponse | undefined
  file: SkillFileResponse | undefined
  fileMutationCoordinator: SkillFileMutationCoordinator
  hasLocalUnpublishedChanges: boolean
  onLocalUnpublishedChangesChange: (hasChanges: boolean) => void
  onPromoteFile: (path: string) => void
  onOpenBuilder?: () => void
  onOpenVersions: () => void
  onPublish: () => void
  onRestoreVersion: () => void
  onExitVersion: () => void
  onCloseFile: (path: string) => void
  onDraftDetailChange: (detail: SkillDetailResponse) => void
  onSaveConflictConfirm: (onConfirm: () => void | Promise<void>) => void
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
  const initialContent =
    file && isTextFile(file) ? normalizeSkillDraftContentForEditing(file.content ?? '') : ''
  const initialSavedAt = detail?.updated_at ? detail.updated_at * 1000 : undefined
  const [draftContent, setDraftContent] = useState(initialContent)
  const [markdownMode, setMarkdownMode] = useState<'live' | 'source'>('live')
  const [metadataAdding, setMetadataAdding] = useState(false)
  const [metadataKey, setMetadataKey] = useState('')
  const [metadataValue, setMetadataValue] = useState('')
  const [referencePicker, setReferencePicker] = useState<{
    anchor: { x: number; y: number }
    currentDirectory: string
    query: string
    slashIndex: number
  } | null>(null)
  const [publishConfirmOpen, setPublishConfirmOpen] = useState(false)
  const [publishReferenceCountOverride, setPublishReferenceCountOverride] = useState<number | null>(
    null,
  )
  const [referenceSelectedIndex, setReferenceSelectedIndex] = useState(0)
  const [saveStatus, setSaveStatus] = useState<'dirty' | 'error' | 'saved' | 'saving'>('saved')
  const [hasSaveConflict, setHasSaveConflict] = useState(false)
  const [saveConflictReloadContent, setSaveConflictReloadContent] = useState<string | null>(null)
  const [saveConflictReloadDetail, setSaveConflictReloadDetail] =
    useState<SkillDetailResponse | null>(null)
  const [fileObjectUrl, setFileObjectUrl] = useState<string>()
  const [savedAt, setSavedAt] = useState<number | undefined>(initialSavedAt)
  const [externalContentRevision, setExternalContentRevision] = useState(0)
  const draftContentRef = useRef(initialContent)
  const lastSavedContentRef = useRef(initialContent)
  const saveConflictContentRef = useRef<string | null>(null)
  const saveConflictReloadContentRef = useRef<string | null>(null)
  const handleSaveConflictReloadRef = useRef<() => void>(() => {})
  const detailRef = useRef(detail)
  const fileRef = useRef(file)
  const pendingPublishAfterSaveRef = useRef(false)
  const metadataKeyInputRef = useRef<HTMLInputElement>(null)
  const metadataKeyDraftRef = useRef('')
  const metadataValueDraftRef = useRef('')
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
  const editableDraftContent = useMemo(
    () => normalizeSkillDraftContentForEditing(draftContent),
    [draftContent],
  )
  const markdownContent = useMemo(() => {
    if (!isSkillManifestFile) {
      return {
        body: stripSkillFrontmatterForDisplay(editableDraftContent),
        description: '',
        displayName: '',
        metadata: [],
        name: '',
      }
    }

    const parsed = parseMarkdownContent(editableDraftContent)
    return {
      ...parsed,
      name: parsed.name.startsWith('untitled-skill-') ? '' : parsed.name,
    }
  }, [editableDraftContent, isSkillManifestFile])
  const csvRows = useMemo(() => parseCsvRows(editableDraftContent), [editableDraftContent])
  const hasPublishedVersion = !!detail?.latest_published_version_id
  const latestPublishedAt = detail?.latest_published_at
  const hasUnpublishedChanges =
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
    if (editableDraftContent === draftContent) return

    draftContentRef.current = editableDraftContent
    if (lastSavedContentRef.current === draftContent)
      lastSavedContentRef.current = editableDraftContent
    if (saveConflictContentRef.current === draftContent)
      saveConflictContentRef.current = editableDraftContent
    setDraftContent(editableDraftContent)
    setSaveStatus(editableDraftContent === lastSavedContentRef.current ? 'saved' : 'dirty')
    setExternalContentRevision((revision) => revision + 1)
  }, [draftContent, editableDraftContent])
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
        if (saveConflictReloadContentRef.current != null)
          onSaveConflictConfirm(handleSaveConflictReloadRef.current)
        return false
      }

      setHasSaveConflict(false)
      setSaveStatus('saving')
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
        return true
      } catch (error) {
        const errorPayload = await getAsyncSkillErrorPayload(error)
        if (getErrorCode(errorPayload ?? error) === 'skill_name_conflict') {
          toast.error(
            t(($) => $['skillManagement.errors.nameConflict'], {
              name: getErrorDetailString(errorPayload ?? error, 'name') ?? '',
            }),
          )
          setSaveStatus('error')
          return false
        }
        if (getErrorCode(errorPayload ?? error) === 'skill_conflict') {
          try {
            const currentUpdatedAt = getErrorDetailNumber(
              errorPayload ?? error,
              'current_updated_at',
            )
            const currentFileContent = getErrorDetailString(
              errorPayload ?? error,
              'current_file_content',
            )
            let latestDetail: SkillDetailResponse | undefined
            try {
              latestDetail = await refreshSkillDetailAfterConflict(queryClient, skillId, {
                updateCache: false,
              })
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
              lastSavedContentRef.current = normalizeSkillDraftContentForEditing(latestFile.content)
            else if (currentFileContent != null)
              lastSavedContentRef.current = normalizeSkillDraftContentForEditing(currentFileContent)
            const recoveredDetail = refetchedDetail ?? {
              ...currentDetail,
              updated_at: latestUpdatedAt,
            }
            fileMutationCoordinator.latestDetail = recoveredDetail

            const latestContent =
              latestFile?.content != null
                ? normalizeSkillDraftContentForEditing(latestFile.content)
                : currentFileContent != null
                  ? normalizeSkillDraftContentForEditing(currentFileContent)
                  : null
            saveConflictReloadContentRef.current = latestContent
            saveConflictContentRef.current =
              draftContentRef.current === lastSavedContentRef.current
                ? null
                : draftContentRef.current
            setSaveConflictReloadContent(latestContent)
            setSaveConflictReloadDetail(recoveredDetail)

            setHasSaveConflict(saveConflictContentRef.current != null)
            setSavedAt(latestUpdatedAt * 1000)
            setSaveStatus('saved')
            onSaveConflictConfirm(handleSaveConflictReloadRef.current)
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
      onSaveConflictConfirm,
      queryClient,
      saveDraftFile,
      skillId,
      t,
    ],
  )
  const handleSaveConflictReload = useCallback(async () => {
    let latestDetail = saveConflictReloadDetail
    let useFetchedDetail = false
    try {
      const fetchedDetail = await refreshSkillDetailAfterConflict(queryClient, skillId, {
        updateCache: false,
      })
      if (!latestDetail || fetchedDetail.updated_at >= latestDetail.updated_at) {
        useFetchedDetail = true
        latestDetail = fetchedDetail
      }
    } catch {
      // Keep the snapshot fetched when the conflict was detected as a fallback.
    }

    const latestFile = latestDetail ? findFileByPath(latestDetail.files ?? [], filePath) : undefined
    const fallbackContent = saveConflictReloadContentRef.current ?? saveConflictReloadContent
    const latestContent =
      useFetchedDetail && latestFile && isTextFile(latestFile) && latestFile.content != null
        ? normalizeSkillDraftContentForEditing(latestFile.content)
        : fallbackContent
    if (latestContent == null) return

    if (latestDetail) {
      const detailToApply = {
        ...latestDetail,
        files: (latestDetail.files ?? []).map((candidateFile) =>
          candidateFile.path === filePath && isTextFile(candidateFile)
            ? {
                ...candidateFile,
                content: latestContent,
                size: latestContent.length,
              }
            : candidateFile,
        ),
      }
      detailRef.current = detailToApply
      fileMutationCoordinator.latestDetail = detailToApply
      const appliedFile = findFileByPath(detailToApply.files ?? [], filePath)
      if (appliedFile) fileRef.current = appliedFile
      setSkillDetailCache(queryClient, skillId, detailToApply)
      onDraftDetailChange(detailToApply)
    }
    draftContentRef.current = latestContent
    lastSavedContentRef.current = latestContent
    saveConflictContentRef.current = null
    saveConflictReloadContentRef.current = null
    setDraftContent(latestContent)
    setHasSaveConflict(false)
    setSaveConflictReloadContent(null)
    setSaveConflictReloadDetail(null)
    setSaveStatus('saved')
    setExternalContentRevision((revision) => revision + 1)
  }, [
    fileMutationCoordinator,
    filePath,
    onDraftDetailChange,
    queryClient,
    saveConflictReloadContent,
    saveConflictReloadDetail,
    skillId,
  ])
  useEffect(() => {
    handleSaveConflictReloadRef.current = handleSaveConflictReload
  }, [handleSaveConflictReload])
  const canEditRef = useRef(canEdit)
  const saveDraftContentRef = useRef(saveDraftContent)

  detailRef.current = detail
  fileRef.current = file
  canEditRef.current = canEdit

  useEffect(() => {
    const currentFile = fileRef.current
    const nextContent =
      currentFile && isTextFile(currentFile)
        ? normalizeSkillDraftContentForEditing(currentFile.content ?? '')
        : ''

    draftContentRef.current = nextContent
    lastSavedContentRef.current = nextContent
    saveConflictContentRef.current = null
    setHasSaveConflict(false)
    setDraftContent(nextContent)
    setSaveStatus('saved')
    setMetadataAdding(false)
    setMetadataKey('')
    setMetadataValue('')
    metadataKeyDraftRef.current = ''
    metadataValueDraftRef.current = ''
    setReferencePicker(null)
    setExternalContentRevision(0)
  }, [editorInstanceKey])

  useEffect(() => {
    if (!file || !isTextFile(file) || file.content == null) return
    if (draftContentRef.current !== lastSavedContentRef.current) return
    const nextContent = normalizeSkillDraftContentForEditing(file.content)
    if (nextContent === lastSavedContentRef.current) return

    draftContentRef.current = nextContent
    lastSavedContentRef.current = nextContent
    saveConflictContentRef.current = null
    setHasSaveConflict(false)
    setDraftContent(nextContent)
    setSavedAt(detail?.updated_at ? detail.updated_at * 1000 : undefined)
    setSaveStatus('saved')
    setExternalContentRevision((revision) => revision + 1)
  }, [detail?.updated_at, file, fileHash])

  useEffect(() => {
    if (!shouldFetchTextFileContent || textContentQuery.data == null) return
    if (draftContentRef.current !== lastSavedContentRef.current) return
    const nextContent = normalizeSkillDraftContentForEditing(textContentQuery.data)

    draftContentRef.current = nextContent
    lastSavedContentRef.current = nextContent
    saveConflictContentRef.current = null
    setHasSaveConflict(false)
    setDraftContent(nextContent)
    setSaveStatus('saved')
    setExternalContentRevision((revision) => revision + 1)
  }, [shouldFetchTextFileContent, textContentQuery.data])

  useEffect(() => {
    if (!canEdit) return
    if (draftContent === lastSavedContentRef.current) return
    if (draftContent === saveConflictContentRef.current) return
    if (saveStatus === 'saving' || saveStatus === 'error') return

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
    if (!binaryPreviewQuery.data) {
      setFileObjectUrl(undefined)
      return
    }

    const objectUrl = URL.createObjectURL(binaryPreviewQuery.data)
    setFileObjectUrl(objectUrl)

    return () => URL.revokeObjectURL(objectUrl)
  }, [binaryPreviewQuery.data])

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

  const handleAddMetadata = (keyOverride?: string, valueOverride?: string) => {
    const nextKey = (keyOverride ?? metadataKey).trim()
    if (
      !isSkillManifestFile ||
      !isEditableMetadataKey(nextKey) ||
      isProtectedMarkdownMetadataKey(nextKey)
    )
      return

    updateDraftContent(
      addMarkdownMetadata(draftContentRef.current, nextKey, valueOverride ?? metadataValue),
    )
    metadataKeyDraftRef.current = ''
    metadataValueDraftRef.current = ''
    setMetadataKey('')
    setMetadataValue('')
    setMetadataAdding(false)
  }

  const handleRemoveMetadata = (key: string) => {
    if (!isSkillManifestFile) return

    updateDraftContent(removeMarkdownMetadata(draftContentRef.current, key))
  }

  const handleCancelAddMetadata = () => {
    metadataKeyDraftRef.current = ''
    metadataValueDraftRef.current = ''
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

    const contentToPublish = draftContentRef.current

    if (canEdit && contentToPublish !== lastSavedContentRef.current) {
      const saved = await saveDraftContent(contentToPublish)
      if (!saved) return
    }

    const referenceCount = detail?.reference_count ?? 0
    if (referenceCount > 0) {
      setPublishReferenceCountOverride(null)
      setPublishConfirmOpen(true)
      return
    }

    const references = await queryClient.fetchQuery(
      consoleQuery.workspaces.current.skills.bySkillId.references.get.queryOptions({
        input: {
          params: {
            skill_id: skillId,
          },
        },
      }),
    )
    const fetchedReferenceCount = references.data?.length ?? 0
    if (fetchedReferenceCount > 0) {
      if (detail && detail.reference_count !== fetchedReferenceCount)
        setSkillDetailCache(queryClient, skillId, {
          ...detail,
          reference_count: fetchedReferenceCount,
        })
      setPublishReferenceCountOverride(fetchedReferenceCount)
      setPublishConfirmOpen(true)
      return
    }

    onPublish()
  }, [
    canEdit,
    detail,
    onPublish,
    publishDisabled,
    queryClient,
    saveDraftContent,
    saveStatus,
    skillId,
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
    <main className="relative my-1 mr-1 flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-lg bg-background-default inset-ring-[0.5px] inset-ring-divider-subtle">
      <FileTabs
        endAction={
          onOpenBuilder && (
            <button
              type="button"
              aria-label={t(($) => $['skillManagement.detail.builder.open'])}
              className="flex h-8 w-33.25 cursor-pointer items-center justify-center gap-0.5 rounded-lg border-[0.5px] border-components-button-secondary-border bg-components-button-secondary-bg px-3 py-2 system-xs-semibold-uppercase text-text-accent shadow-xs outline-hidden backdrop-blur-[5px] hover:bg-components-button-secondary-bg-hover focus-visible:ring-2 focus-visible:ring-state-accent-solid"
              onClick={onOpenBuilder}
            >
              <span aria-hidden className="i-ri-box-3-line size-4" />
              {t(($) => $['skillManagement.detail.builder.title'])}
            </button>
          )
        }
        files={openFiles}
        onClose={onCloseFile}
        onSelect={onSelectFile}
        previewPath={previewFilePath}
        selectedPath={selectedPath}
      />
      <div className="mt-px min-h-0 flex-1 overflow-hidden">
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
              <div className="mx-auto max-w-3xl">
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
                      <div
                        className="w-full space-y-0.5"
                        onBlurCapture={(event) => {
                          if (event.currentTarget.contains(event.relatedTarget as Node | null))
                            return

                          handleAddMetadata(
                            metadataKeyDraftRef.current,
                            metadataValueDraftRef.current,
                          )
                        }}
                      >
                        <div className="flex h-6 items-center gap-1">
                          <input
                            ref={metadataKeyInputRef}
                            value={metadataKey}
                            placeholder={t(($) => $['skillManagement.detail.metadataKey'])}
                            className={metadataKeyInputClassName}
                            onChange={(event) => {
                              metadataKeyDraftRef.current = event.target.value
                              setMetadataKey(event.target.value)
                            }}
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
                            <span aria-hidden className="i-ri-delete-bin-line size-3.5" />
                          </button>
                        </div>
                        <input
                          value={metadataValue}
                          placeholder={t(($) => $['skillManagement.detail.metadataValue'])}
                          className={metadataValueInputClassName}
                          onChange={(event) => {
                            metadataValueDraftRef.current = event.target.value
                            setMetadataValue(event.target.value)
                          }}
                          onKeyDown={(event) => {
                            if (event.key === 'Escape') {
                              handleCancelAddMetadata()
                              return
                            }
                            if (event.key === 'Enter') {
                              event.preventDefault()
                              event.stopPropagation()
                              handleAddMetadata(
                                metadataKeyInputRef.current?.value,
                                event.currentTarget.value,
                              )
                            }
                          }}
                          onKeyUp={(event) => {
                            if (event.key !== 'Enter') return

                            event.preventDefault()
                            event.stopPropagation()
                            handleAddMetadata(
                              metadataKeyInputRef.current?.value,
                              event.currentTarget.value,
                            )
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
                          <span className="px-0.75">
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
                      className="min-h-90"
                      onOpenReference={onSelectFile}
                      placeholder={t(
                        ($) => $['skillManagement.detail.referenceFiles.livePlaceholder'],
                      )}
                    />
                  ) : (
                    <div className="relative min-h-90">
                      <MarkdownLiveBodyEditor
                        key={editorRenderKey}
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
              value={editableDraftContent}
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
          <div className="h-full overflow-hidden bg-background-default">
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
              value={editableDraftContent}
              spellCheck={false}
              className={cn(
                'h-full w-full resize-none bg-background-default p-4 font-mono text-[13px]/[20px] text-text-secondary outline-hidden read-only:bg-background-section',
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
          <div className="flex h-full items-center justify-center bg-background-default">
            <SkeletonRectangle className="h-full w-full" />
          </div>
        ) : canPreviewBinaryFile && binaryPreviewQuery.isError ? (
          <div className="flex h-full items-center justify-center bg-background-default">
            <p className="system-sm-regular text-text-tertiary">
              {t(($) => $['skillManagement.detail.loadFailed'])}
            </p>
          </div>
        ) : isSkillImageFile(file) && fileObjectUrl ? (
          <div className="flex h-full items-center justify-center overflow-hidden bg-background-default pt-1 pr-4 pb-2 pl-4">
            <img
              src={fileObjectUrl}
              alt={file.path}
              className="max-h-full max-w-full object-contain"
            />
          </div>
        ) : isSkillPdfFile(file) && fileObjectUrl ? (
          <div className="h-full overflow-hidden bg-background-default pt-1 pl-3">
            <SkillPdfPreview fileName={file.path} url={fileObjectUrl} />
          </div>
        ) : (
          <div className="flex h-full items-center justify-center bg-background-default">
            <div className="flex w-64 flex-col items-center text-center">
              <span aria-hidden className={cn('size-16', getSkillFileIconClass(file))} />
              <p className="mt-1 max-w-full truncate system-sm-medium text-text-secondary">
                {getPathBaseName(file.path)}
              </p>
              <p className="mt-1 system-xs-regular text-text-tertiary">
                {t(($) => $['skillManagement.detail.fileMeta'], {
                  size: file.size ?? 0,
                  type: file.mime_type ?? file.kind,
                })}
              </p>
              <div className="mt-3 h-px w-full bg-divider-subtle" />
              <p className="mt-3 system-xs-regular text-text-tertiary">
                {t(($) => $['skillManagement.detail.previewUnsupported'])}
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
        <SkillPublishBottomActions>
          <div className="flex max-w-[calc(100%-2rem)] flex-col items-center justify-end">
            <SkillPublishConfirmPanel
              loading={publishing}
              onCancel={() => {
                setPublishConfirmOpen(false)
                setPublishReferenceCountOverride(null)
              }}
              onConfirm={() => {
                setPublishConfirmOpen(false)
                setPublishReferenceCountOverride(null)
                onPublish()
              }}
              open={publishConfirmOpen}
              referenceCount={publishReferenceCountOverride ?? detail?.reference_count ?? 0}
              skillId={skillId}
            />
            <div
              className={cn(publishConfirmOpen && 'hidden')}
              aria-hidden={publishConfirmOpen || undefined}
              hidden={publishConfirmOpen}
            >
              <SkillPublishBar
                canPublish={canPublish}
                metaLabel={publishMetaText}
                onOpenVersions={onOpenVersions}
                onPublish={handlePublish}
                state={publishState}
              />
            </div>
          </div>
        </SkillPublishBottomActions>
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
