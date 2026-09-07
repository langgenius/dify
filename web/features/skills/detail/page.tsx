'use client'

/* oxlint-disable eslint-react/set-state-in-effect -- The detail route resets local draft overrides when the selected skill or authoritative query snapshot changes. */

import type { SkillDetailResponse } from '@dify/contracts/api/console/workspaces/types.gen'
import type { SkillFileMutationCoordinator } from './shared'
import {
  AlertDialog,
  AlertDialogActions,
  AlertDialogConfirmButton,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from '@langgenius/dify-ui/alert-dialog'
import { toast } from '@langgenius/dify-ui/toast'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import useDocumentTitle from '@/hooks/use-document-title'
import Link from '@/next/link'
import { consoleQuery } from '@/service/client'
import { useSkillPermissions } from '../permissions'
import { SkillBuilderPanel } from './builder-panel'
import { FileEditor } from './file-editor'
import { FileTree } from './file-tree'
import {
  deriveSkillDetailFromDraftFiles,
  findFileByPath,
  getFirstTextFile,
  getSkillVersionTitle,
  isDirectory,
  setSkillDetailCache,
  showSkillErrorToast,
} from './shared'
import { DetailSkeleton } from './shell'
import { RestoreVersionDialog, VersionPanel } from './version-panel'

export function SkillDetailPage({ skillId }: { skillId: string }) {
  const { t } = useTranslation('skill')
  const queryClient = useQueryClient()
  const { canEdit, canPublish, canDelete } = useSkillPermissions()
  const [selectedPath, setSelectedPath] = useState<string>()
  const [openFilePaths, setOpenFilePaths] = useState<string[]>([])
  const [previewFilePath, setPreviewFilePath] = useState<string>()
  const [rightPanelMode, setRightPanelMode] = useState<'builder' | 'hidden' | 'versions'>('builder')
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [selectedVersionId, setSelectedVersionId] = useState<string | null>()
  const [restoreVersionConfirmOpen, setRestoreVersionConfirmOpen] = useState(false)
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
  const fileMutationCoordinator = useMemo<SkillFileMutationCoordinator>(
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
  const skillDetailQueryKey = consoleQuery.workspaces.current.skills.bySkillId.get.key({
    type: 'query',
    input: {
      params: {
        skill_id: skillId,
      },
    },
  })
  const detailQuery = useQuery(skillDetailQueryOptions)
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
  const versionDetailQuery = useQuery({
    ...consoleQuery.workspaces.current.skills.bySkillId.versions.byVersionId.get.queryOptions({
      input: {
        params: {
          skill_id: skillId,
          version_id: activeVersionId ?? '',
        },
      },
    }),
    enabled: !!activeVersionId,
  })
  const publishMutation = useMutation(
    consoleQuery.workspaces.current.skills.bySkillId.publish.post.mutationOptions({
      context: { silent: true },
    }),
  )
  const restoreMutation = useMutation(
    consoleQuery.workspaces.current.skills.bySkillId.restore.post.mutationOptions(),
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
    (!fileMutationCoordinator.latestDetail ||
      detail.updated_at > fileMutationCoordinator.latestDetail.updated_at)
  )
    fileMutationCoordinator.latestDetail = detail
  const draftFiles = detail?.files ?? []
  const readonlyFiles = versionDetailQuery.data?.files ?? []
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
        onSuccess: async (version) => {
          toast.success(t(($) => $['skillManagement.detail.publishSuccess']))
          setPublishedOverride({
            id: version.id,
            publishedAt: version.created_at,
            versionNumber: version.version_number,
          })
          setHasLocalUnpublishedChanges(false)
          const detailQueryKey = consoleQuery.workspaces.current.skills.bySkillId.get.key({
            type: 'query',
            input: {
              params: {
                skill_id: skillId,
              },
            },
          })
          if (detail) {
            setSkillDetailCache(queryClient, skillId, {
              ...detail,
              latest_published_at: version.created_at,
              latest_published_version_id: version.id,
              latest_published_version_number: version.version_number,
            })
          }
          await queryClient.invalidateQueries({ queryKey: detailQueryKey })
          await queryClient.refetchQueries({ queryKey: detailQueryKey, type: 'active' })
          void queryClient.invalidateQueries({
            queryKey: consoleQuery.workspaces.current.skills.bySkillId.versions.get.key({
              type: 'query',
              input: {
                params: {
                  skill_id: skillId,
                },
              },
            }),
          })
          void queryClient.invalidateQueries({
            queryKey: consoleQuery.workspaces.current.skills.get.key({ type: 'query' }),
          })
          void queryClient.invalidateQueries({
            queryKey: consoleQuery.workspaces.current.skills.get.key({ type: 'infinite' }),
          })
        },
        onError: (error) => {
          showSkillErrorToast(
            error,
            t(($) => $['skillManagement.detail.publishFailed']),
          )
        },
      },
    )
  }
  const restoreSelectedVersion = async () => {
    if (!selectedVersion || restoreMutation.isPending) return

    try {
      await restoreMutation.mutateAsync({
        params: {
          skill_id: skillId,
        },
        body: {
          version_id: selectedVersion.id,
          version_name: selectedVersion.version_name,
        },
      })
      await queryClient.invalidateQueries({ queryKey: skillDetailQueryKey })
      await queryClient.refetchQueries({ queryKey: skillDetailQueryKey, type: 'active' })
      void queryClient.invalidateQueries({
        queryKey: consoleQuery.workspaces.current.skills.bySkillId.versions.get.key({
          type: 'query',
          input: {
            params: {
              skill_id: skillId,
            },
          },
        }),
      })
      void queryClient.invalidateQueries({
        queryKey: consoleQuery.workspaces.current.skills.get.key({ type: 'query' }),
      })
      void queryClient.invalidateQueries({
        queryKey: consoleQuery.workspaces.current.skills.get.key({ type: 'infinite' }),
      })
      toast.success(t(($) => $['skillManagement.detail.restoreVersionSuccess']))
      setSelectedVersionId(null)
      setRightPanelMode('builder')
      setSelectedPath(undefined)
      setOpenFilePaths([])
      setPreviewFilePath(undefined)
    } catch {
      toast.error(t(($) => $['skillManagement.detail.restoreVersionFailed']))
    }
  }

  const handleRestoreSelectedVersion = () => {
    if (!selectedVersion || restoreMutation.isPending) return
    setRestoreVersionConfirmOpen(true)
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

  if (detailQuery.isPending) return <DetailSkeleton />

  if (detailQuery.isError || !detail) {
    return (
      <div className="flex h-0 min-w-0 grow items-center justify-center bg-background-body p-6">
        <div className="flex flex-col items-center gap-3">
          <span aria-hidden className="i-ri-error-warning-line size-8 text-text-quaternary" />
          <p className="system-sm-regular text-text-tertiary">
            {t(($) => $['skillManagement.detail.loadFailed'])}
          </p>
          <Link
            href="/skills"
            className="rounded-md system-sm-medium text-text-accent outline-hidden focus-visible:ring-2 focus-visible:ring-state-accent-solid"
          >
            {t(($) => $['skillManagement.detail.back'])}
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-0 min-w-0 grow overflow-hidden bg-background-body">
      <div className="flex min-h-0 min-w-0 flex-1">
        <FileTree
          canDelete={canDelete}
          canEdit={canEdit}
          collapsed={sidebarCollapsed}
          detail={detail}
          fileMutationCoordinator={fileMutationCoordinator}
          files={activeFiles}
          onCollapsedChange={setSidebarCollapsed}
          onSelect={handleOpenFile}
          readonly={!!activeVersionId || !canEdit}
          selectedPath={activeSelectedPath}
          skillId={skillId}
        />
        <FileEditor
          canPublish={canPublish}
          key={`${activeVersionId ?? 'draft'}:${activeSelectedPath ?? 'empty'}`}
          detail={detail}
          file={selectedFile}
          fileMutationCoordinator={fileMutationCoordinator}
          hasLocalUnpublishedChanges={hasLocalUnpublishedChanges}
          onCloseFile={handleCloseFile}
          onDraftDetailChange={handleDraftDetailChange}
          onSaveConflictConfirm={(onConfirm) => {
            setSaveConflictConfirm(() => onConfirm)
          }}
          onLocalUnpublishedChangesChange={setHasLocalUnpublishedChanges}
          onPromoteFile={handlePromoteFile}
          onOpenBuilder={
            canEdit && rightPanelMode === 'hidden' ? () => setRightPanelMode('builder') : undefined
          }
          onOpenVersions={handleOpenVersions}
          onPublish={handlePublish}
          onRestoreVersion={handleRestoreSelectedVersion}
          onExitVersion={handleExitVersion}
          onSelectFile={handleOpenFile}
          openFiles={openFiles}
          previewFilePath={previewFilePath}
          publishing={activeVersionId ? restoreMutation.isPending : publishMutation.isPending}
          readonly={!!activeVersionId || !canEdit}
          selectedPath={activeSelectedPath}
          selectedVersion={selectedVersion}
          selectedVersionId={activeVersionId}
          skillId={skillId}
        />
        <AlertDialog open={!!saveConflictConfirm}>
          <AlertDialogContent className="p-6">
            <AlertDialogTitle className="title-2xl-semi-bold text-text-primary">
              {t(($) => $['skillManagement.detail.saveConflictConfirmTitle'])}
            </AlertDialogTitle>
            <AlertDialogDescription className="mt-2 system-md-regular text-text-tertiary">
              {t(($) => $['skillManagement.detail.saveConflictConfirmDescription'])}
            </AlertDialogDescription>
            <AlertDialogActions className="p-0 pt-6">
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
            </AlertDialogActions>
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
          <VersionPanel
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
        {selectedVersion && (
          <RestoreVersionDialog
            open={restoreVersionConfirmOpen}
            loading={restoreMutation.isPending}
            versionTitle={getSkillVersionTitle(selectedVersion)}
            onOpenChange={setRestoreVersionConfirmOpen}
            onConfirm={() => {
              void restoreSelectedVersion()
            }}
          />
        )}
      </div>
    </div>
  )
}
