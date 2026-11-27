'use client'

import type { SkillDetailResponse } from '@dify/contracts/api/console/workspaces/types.gen'
import type { SkillDraftMutationCoordinator } from './mutations'
import {
  AlertDialog,
  AlertDialogConfirmButton,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@langgenius/dify-ui/alert-dialog'
import { Button } from '@langgenius/dify-ui/button'
import { skipToken, useMutation, useQuery } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from '@/app/notifications'
import useDocumentTitle from '@/hooks/use-document-title'
import Link from '@/next/link'
import { consoleQuery } from '@/service/console'
import { useOwnedQueryError, useOwnedQueryErrors } from '@/service/use-owned-query-error'
import { useRequestErrorMessage } from '@/service/use-request-error-message'
import { getErrorMessage } from '@/utils/error-message'
import { useSkillPermissions } from '../permissions'
import { SkillLoadError } from '../references'
import { SkillBuilderPanel } from './builder/panel'
import { deriveSkillDetailFromDraftFiles } from './draft'
import { SkillFileEditor } from './files/editor'
import { isDirectory } from './files/file-format'
import { SkillFileTree } from './files/tree'
import { findFileByPath, getFirstTextFile } from './files/tree-model'
import { SkillDetailSkeleton } from './skeleton'
import { SkillVersionPanel } from './versions/panel'

export function SkillDetailPage({ skillId }: { skillId: string }) {
  const { t } = useTranslation(['skill', 'common'])
  const { canEdit, canPublish, canDelete } = useSkillPermissions()
  const [selectedPath, setSelectedPath] = useState<string>()
  const [openFilePaths, setOpenFilePaths] = useState<string[]>([])
  const [previewFilePath, setPreviewFilePath] = useState<string>()
  const [rightPanelMode, setRightPanelMode] = useState<'builder' | 'hidden' | 'versions'>('builder')
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [selectedVersionId, setSelectedVersionId] = useState<string | null>()
  const [draftDetailOverride, setDraftDetailOverride] = useState<SkillDetailResponse>()
  const [hasLocalUnpublishedChanges, setHasLocalUnpublishedChanges] = useState(false)
  const [saveConflictConfirm, setSaveConflictConfirm] = useState<
    (() => void | Promise<void>) | null
  >(null)
  const [saveConflictReloading, setSaveConflictReloading] = useState(false)
  const [publishedOverride, setPublishedOverride] = useState<{
    id: string
    publishedAt: number
    versionNumber: number
  } | null>(null)
  const draftMutationCoordinator = useMemo<SkillDraftMutationCoordinator>(
    () => ({
      latestDetail: undefined,
      queue: Promise.resolve(),
      skillId,
    }),
    [skillId],
  )
  const skillDetailQueryOptions = consoleQuery.workspaces.current.skills.bySkillId.get.queryOptions(
    {
      input: {
        params: {
          skill_id: skillId,
        },
      },
    },
  )
  const detailQuery = useQuery(skillDetailQueryOptions)
  const detailLoad = useOwnedQueryError(detailQuery)
  const detailLoadErrorMessage =
    useRequestErrorMessage(
      detailLoad?.error,
      t(($) => $['skillManagement.detail.loadFailed']),
    ) ?? t(($) => $['skillManagement.detail.loadFailed'])
  const versionsQuery = useQuery(
    consoleQuery.workspaces.current.skills.bySkillId.versions.get.queryOptions({
      input: {
        params: {
          skill_id: skillId,
        },
      },
    }),
  )
  const versions = versionsQuery.data?.data ?? []
  const defaultVersionId =
    rightPanelMode === 'versions'
      ? (versions.find((version) => version.is_latest)?.id ?? versions[0]?.id ?? null)
      : null
  const activeVersionId = selectedVersionId === undefined ? defaultVersionId : selectedVersionId
  const versionDetailQuery = useQuery(
    consoleQuery.workspaces.current.skills.bySkillId.versions.byVersionId.get.queryOptions({
      input: activeVersionId
        ? { params: { skill_id: skillId, version_id: activeVersionId } }
        : skipToken,
    }),
  )
  const publishMutation = useMutation(
    consoleQuery.workspaces.current.skills.bySkillId.publish.post.mutationOptions({
      meta: { errorToast: false },
    }),
  )
  const queriedDetail = detailQuery.data
  const baseDetail = draftDetailOverride ?? queriedDetail
  const detail = useMemo<SkillDetailResponse | undefined>(() => {
    if (!baseDetail || !publishedOverride) return baseDetail

    return {
      ...baseDetail,
      latest_published_at: publishedOverride.publishedAt,
      latest_published_version_id: publishedOverride.id,
      latest_published_version_number: publishedOverride.versionNumber,
    }
  }, [baseDetail, publishedOverride])
  if (
    detail &&
    (!draftMutationCoordinator.latestDetail ||
      detail.updated_at > draftMutationCoordinator.latestDetail.updated_at)
  )
    draftMutationCoordinator.latestDetail = detail
  const draftFiles = detail?.files ?? []
  const readonlyFiles = versionDetailQuery.data?.files ?? []
  const versionDetailFailed = useOwnedQueryError(versionDetailQuery)
  // The versions panel, while open, replaces the list with a failed first load.
  const versionsLoad = useOwnedQueryErrors(rightPanelMode === 'versions' ? [versionsQuery] : [])
  const activeFiles = activeVersionId ? readonlyFiles : draftFiles
  const fallbackFile = getFirstTextFile(activeFiles)
  const manifestFile = findFileByPath(activeFiles, 'SKILL.md') ?? fallbackFile
  const activeSelectedPath =
    selectedPath && findFileByPath(activeFiles, selectedPath) ? selectedPath : fallbackFile?.path
  const selectedFile = findFileByPath(activeFiles, activeSelectedPath)
  const orderedOpenPaths = [
    manifestFile?.path,
    ...openFilePaths,
    previewFilePath,
    activeSelectedPath,
  ].filter((path, index, paths): path is string => !!path && paths.indexOf(path) === index)
  const openFiles = orderedOpenPaths
    .map((path) => findFileByPath(activeFiles, path))
    .filter((file): file is NonNullable<typeof file> => !!file && !isDirectory(file))
  const selectedVersion = versions.find((version) => version.id === activeVersionId)

  useDocumentTitle(detail?.display_name ?? t(($) => $['skillManagement.title']))

  useEffect(() => {
    setDraftDetailOverride(undefined)
    setHasLocalUnpublishedChanges(false)
    setPublishedOverride(null)
  }, [skillId])

  useEffect(() => {
    if (!draftDetailOverride || !queriedDetail) return
    if (queriedDetail.updated_at > draftDetailOverride.updated_at) setDraftDetailOverride(undefined)
  }, [draftDetailOverride, queriedDetail])

  const handleDraftDetailChange = useCallback((nextDetail: SkillDetailResponse) => {
    setDraftDetailOverride(deriveSkillDetailFromDraftFiles(nextDetail))
  }, [])

  const handleOpenFile = (
    path: string,
    availableFiles = activeFiles,
    mode: 'pinned' | 'preview' = 'pinned',
  ) => {
    const targetFile = findFileByPath(availableFiles, path)
    if (!targetFile || isDirectory(targetFile)) return

    setSelectedPath(path)
    if (mode === 'preview' && path !== manifestFile?.path && !openFilePaths.includes(path)) {
      setPreviewFilePath(path)
      return
    }

    if (path === previewFilePath) setPreviewFilePath(undefined)
    setOpenFilePaths((currentPaths) =>
      currentPaths.includes(path) ? currentPaths : [...currentPaths, path],
    )
  }

  const handleCloseFile = (path: string) => {
    if (path === manifestFile?.path) return

    const nextPaths = openFilePaths.filter((currentPath) => currentPath !== path)
    setOpenFilePaths(nextPaths)
    if (path === previewFilePath) setPreviewFilePath(undefined)

    if (path === activeSelectedPath) {
      const nextSelectedPath =
        nextPaths.at(-1) ??
        (previewFilePath !== path ? previewFilePath : undefined) ??
        manifestFile?.path
      setSelectedPath(nextSelectedPath)
    }
  }

  const handlePromoteFile = (path: string) => {
    if (path !== previewFilePath) return

    setPreviewFilePath(undefined)
    setOpenFilePaths((currentPaths) =>
      currentPaths.includes(path) ? currentPaths : [...currentPaths, path],
    )
  }

  const handlePublish = () => {
    if (publishMutation.isPending) return

    publishMutation.mutate(
      {
        params: {
          skill_id: skillId,
        },
        body: {},
      },
      {
        onSuccess: (version) => {
          toast.success(t(($) => $['skillManagement.detail.publishSuccess']))
          setPublishedOverride({
            id: version.id,
            publishedAt: version.created_at,
            versionNumber: version.version_number,
          })
          setHasLocalUnpublishedChanges(false)
        },
        onError: (error) => {
          toast.error(getErrorMessage(error) ?? t(($) => $['skillManagement.detail.publishFailed']))
        },
      },
    )
  }
  const handleVersionRestored = () => {
    setSelectedVersionId(null)
    setRightPanelMode('builder')
    setSelectedPath(undefined)
    setOpenFilePaths([])
    setPreviewFilePath(undefined)
  }

  const handleExitVersion = () => {
    setSelectedVersionId(undefined)
    setRightPanelMode('builder')
    setSelectedPath(undefined)
    setOpenFilePaths([])
    setPreviewFilePath(undefined)
  }

  const handleOpenVersions = () => {
    setSelectedVersionId(undefined)
    setRightPanelMode('versions')
    setSelectedPath(undefined)
    setOpenFilePaths([])
    setPreviewFilePath(undefined)
  }

  if (detailQuery.isPending) return <SkillDetailSkeleton />

  // Only a failed first load replaces the page; a failed refetch keeps the cached skill on screen
  // and the query cache reports it.
  if (!detail) {
    return (
      <div className="flex h-0 min-w-0 grow items-center justify-center bg-background-body p-6">
        <div role="alert" className="flex flex-col items-center gap-3">
          <span aria-hidden className="i-ri-error-warning-line size-8 text-text-quaternary" />
          <p className="system-sm-regular text-text-tertiary">{detailLoadErrorMessage}</p>
          <div className="flex items-center gap-3">
            <Button
              size="small"
              variant="secondary"
              loading={detailLoad?.retrying}
              onClick={detailLoad?.retry}
            >
              {t(($) => $['operation.retry'], { ns: 'common' })}
            </Button>
            <Link
              href="/skills"
              className="rounded-md system-sm-medium text-text-accent outline-hidden focus-visible:ring-2 focus-visible:ring-state-accent-solid"
            >
              {t(($) => $['skillManagement.detail.back'])}
            </Link>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-0 min-w-0 grow overflow-hidden bg-background-body">
      <div className="flex min-h-0 min-w-0 flex-1">
        <SkillFileTree
          canDelete={canDelete}
          canEdit={canEdit}
          collapsed={sidebarCollapsed}
          detail={detail}
          draftMutationCoordinator={draftMutationCoordinator}
          files={activeFiles}
          onCollapsedChange={setSidebarCollapsed}
          onSelect={handleOpenFile}
          readonly={!!activeVersionId || !canEdit}
          selectedPath={activeSelectedPath}
          skillId={skillId}
        />
        {versionDetailFailed ? (
          <div className="flex min-w-0 flex-1 items-center justify-center p-6">
            <SkillLoadError
              error={versionDetailFailed.error}
              fallback={t(($) => $['skillManagement.detail.versionLoadFailed'])}
              onRetry={versionDetailFailed.retry}
              retrying={versionDetailFailed.retrying}
            />
          </div>
        ) : (
          <SkillFileEditor
            canPublish={canPublish}
            key={`${activeVersionId ?? 'draft'}:${activeSelectedPath ?? 'empty'}`}
            detail={detail}
            file={selectedFile}
            draftMutationCoordinator={draftMutationCoordinator}
            hasLocalUnpublishedChanges={hasLocalUnpublishedChanges}
            onCloseFile={handleCloseFile}
            onDraftDetailChange={handleDraftDetailChange}
            onSaveConflictConfirm={(onConfirm) => {
              setSaveConflictConfirm(() => onConfirm)
            }}
            onLocalUnpublishedChangesChange={setHasLocalUnpublishedChanges}
            onPromoteFile={handlePromoteFile}
            onOpenBuilder={
              canEdit && rightPanelMode === 'hidden'
                ? () => setRightPanelMode('builder')
                : undefined
            }
            onOpenVersions={handleOpenVersions}
            onPublish={handlePublish}
            onVersionRestored={handleVersionRestored}
            onExitVersion={handleExitVersion}
            onSelectFile={handleOpenFile}
            openFiles={openFiles}
            previewFilePath={previewFilePath}
            publishing={publishMutation.isPending}
            readonly={!!activeVersionId || !canEdit}
            selectedPath={activeSelectedPath}
            selectedVersion={selectedVersion}
            selectedVersionId={activeVersionId}
            skillId={skillId}
          />
        )}
        <AlertDialog open={!!saveConflictConfirm}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                {t(($) => $['skillManagement.detail.saveConflictConfirmTitle'])}
              </AlertDialogTitle>
              <AlertDialogDescription>
                {t(($) => $['skillManagement.detail.saveConflictConfirmDescription'])}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogConfirmButton
                loading={saveConflictReloading}
                tone="default"
                onClick={async () => {
                  if (!saveConflictConfirm) return

                  setSaveConflictReloading(true)
                  try {
                    await saveConflictConfirm()
                    setSaveConflictConfirm(null)
                  } finally {
                    setSaveConflictReloading(false)
                  }
                }}
              >
                {t(($) => $['skillManagement.detail.saveConflictReload'])}
              </AlertDialogConfirmButton>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
        {canEdit && rightPanelMode === 'builder' && (
          <SkillBuilderPanel
            detail={detail}
            selectedFile={selectedFile}
            skillId={skillId}
            onDraftDetailChange={handleDraftDetailChange}
            onClose={() => setRightPanelMode('hidden')}
          />
        )}
        {rightPanelMode === 'versions' && (
          <SkillVersionPanel
            loadError={versionsLoad?.error}
            loadRetrying={versionsLoad?.retrying}
            onRetryLoad={versionsLoad?.retry}
            skillId={skillId}
            versions={versions}
            selectedVersionId={activeVersionId}
            onClose={handleExitVersion}
            onSelect={(versionId) => {
              setSelectedVersionId(versionId)
              setSelectedPath(undefined)
              setOpenFilePaths([])
            }}
          />
        )}
      </div>
    </div>
  )
}
