'use client'

import type {
  SandboxFileEntryResponse,
  SandboxListResponse,
  SandboxReadResponse,
} from '@dify/contracts/api/console/agent/types.gen'
import type { AgentSkillDetailDownloadAction } from '../orchestrate/skills/detail-dialog'
import type {
  AgentWorkingDirectoryPath,
  AgentWorkingDirectoryRootPath,
} from './working-directory-breadcrumb'
import type { AgentFileNode } from '@/features/agent-v2/agent-composer/form-state'
import { Dialog } from '@langgenius/dify-ui/dialog'
import { Tabs, TabsIndicator, TabsList, TabsPanel, TabsTab } from '@langgenius/dify-ui/tabs'
import { toast } from '@langgenius/dify-ui/toast'
import { skipToken, useMutation, useQueries, useQuery } from '@tanstack/react-query'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Infotip } from '@/app/components/base/infotip'
import { consoleClient, consoleQuery } from '@/service/client'
import { downloadUrl } from '@/utils/download'
import { getFileIconType } from '../orchestrate/files/file-icon'
import { AgentSkillDetailDialog } from '../orchestrate/skills/detail-dialog'
import {
  AGENT_SAVED_FILES_ROOT_PATH,
  AGENT_TEMPORARY_FILES_ROOT_PATH,
  AgentWorkingDirectoryBreadcrumb,
} from './working-directory-breadcrumb'

type AgentWorkingDirectoryPanelProps = {
  source: AgentWorkingDirectorySource
  onOpenChange: (open: boolean) => void
  open: boolean
}

export type AgentWorkingDirectorySource =
  | {
      type: 'agent'
      agentId: string
      callerType: 'conversation' | 'build_draft'
      callerId: string
    }
  | {
      type: 'workflow-node'
      appId: string
      nodeId: string
      nodeExecutionId: string
      workflowRunId: string
    }

type SandboxErrorPayload = {
  code?: string
}

const getSandboxRootPath = (path: string): AgentWorkingDirectoryRootPath =>
  path === AGENT_SAVED_FILES_ROOT_PATH || path.startsWith(`${AGENT_SAVED_FILES_ROOT_PATH}/`)
    ? AGENT_SAVED_FILES_ROOT_PATH
    : AGENT_TEMPORARY_FILES_ROOT_PATH

const getSandboxRelativePath = (path: string) => {
  const relativePath = path
    .replace(/^~(?:\/|$)/, '')
    .replace(/^\.\//, '')
    .replace(/^\/+|\/+$/g, '')
  return relativePath === AGENT_TEMPORARY_FILES_ROOT_PATH ? '' : relativePath
}

const toSandboxApiPath = (path: string) => {
  const rootPath = getSandboxRootPath(path)
  const relativePath = getSandboxRelativePath(path)

  return relativePath ? `${rootPath}/${relativePath}` : rootPath
}

const joinSandboxPath = (basePath: string, name: string) => {
  const rootPath = getSandboxRootPath(basePath)
  const baseRelativePath = getSandboxRelativePath(basePath)
  const relativePath = [baseRelativePath, name].filter(Boolean).join('/')

  return relativePath ? `${rootPath}/${relativePath}` : rootPath
}

function getSandboxEntryRelativePathSegments(entryName: string, basePath: string) {
  const normalizedBasePath = getSandboxRelativePath(basePath)
  const normalizedEntryName = getSandboxRelativePath(entryName)

  if (!normalizedEntryName) return []

  if (!normalizedBasePath) return normalizedEntryName.split('/').filter(Boolean)

  if (normalizedEntryName === normalizedBasePath) return []

  if (normalizedEntryName.startsWith(`${normalizedBasePath}/`))
    return normalizedEntryName
      .slice(normalizedBasePath.length + 1)
      .split('/')
      .filter(Boolean)

  return normalizedEntryName.split('/').filter(Boolean)
}

function buildSandboxFileTree(
  entries: SandboxFileEntryResponse[] = [],
  basePath = '.',
  options: { nestRootPath?: string; nestUnderBasePath?: boolean } = {},
): AgentFileNode[] {
  const normalizedBasePath = getSandboxRelativePath(basePath)
  const normalizedNestRootPath = getSandboxRelativePath(options.nestRootPath ?? '.')
  const rootFiles: AgentFileNode[] = []
  let baseFolder: AgentFileNode | undefined

  if (options.nestUnderBasePath && normalizedBasePath) {
    let currentFiles = rootFiles
    let currentPath = toSandboxApiPath(options.nestRootPath ?? basePath)
    const basePathSegments = normalizedBasePath.split('/').filter(Boolean)
    const nestRootPathSegments = normalizedNestRootPath.split('/').filter(Boolean)
    const nestedBasePathSegments =
      normalizedNestRootPath &&
      (normalizedBasePath === normalizedNestRootPath ||
        normalizedBasePath.startsWith(`${normalizedNestRootPath}/`))
        ? basePathSegments.slice(nestRootPathSegments.length)
        : basePathSegments

    nestedBasePathSegments.forEach((segment) => {
      currentPath = joinSandboxPath(currentPath, segment)
      const folder: AgentFileNode = {
        id: currentPath,
        name: segment,
        icon: 'folder',
        children: [],
      }

      currentFiles.push(folder)
      currentFiles = folder.children ?? []
      baseFolder = folder
    })
  }

  for (const entry of entries) {
    const pathSegments = getSandboxEntryRelativePathSegments(entry.name, basePath)
    if (!pathSegments.length) continue

    let currentFiles = baseFolder?.children ?? rootFiles
    let currentPath = toSandboxApiPath(basePath)

    pathSegments.forEach((segment, index) => {
      const isLeaf = index === pathSegments.length - 1
      const isFolder = !isLeaf || entry.type === 'dir'
      const nodePath = joinSandboxPath(currentPath, segment)
      let node = currentFiles.find((file) => file.id === nodePath)

      if (!node) {
        node = {
          id: nodePath,
          name: segment,
          icon: isFolder ? 'folder' : getFileIconType(segment),
          children: isFolder ? [] : undefined,
        }
        currentFiles.push(node)
      }

      if (isFolder) {
        node.children ??= []
        currentFiles = node.children
      }

      currentPath = nodePath
    })
  }

  return rootFiles
}

function mergeSandboxFileTree(
  targetFiles: AgentFileNode[],
  sourceFiles: AgentFileNode[],
): AgentFileNode[] {
  const mergedFiles = [...targetFiles]

  for (const sourceFile of sourceFiles) {
    const targetFileIndex = mergedFiles.findIndex((file) => file.id === sourceFile.id)
    if (targetFileIndex === -1) {
      mergedFiles.push(sourceFile)
      continue
    }

    const targetFile = mergedFiles[targetFileIndex]!
    mergedFiles[targetFileIndex] = {
      ...targetFile,
      ...sourceFile,
      children: mergeSandboxFileTree(targetFile.children ?? [], sourceFile.children ?? []),
    }
  }

  return mergedFiles
}

function findFirstReadableFile(files: AgentFileNode[]): AgentFileNode | undefined {
  for (const file of files) {
    if (file.children?.length) {
      const childFile = findFirstReadableFile(file.children)
      if (childFile) return childFile
    } else if (file.icon !== 'folder') {
      return file
    }
  }
}

function findReadableFile(files: AgentFileNode[], fileId?: string): AgentFileNode | undefined {
  if (!fileId) return undefined

  for (const file of files) {
    if (file.id === fileId && file.icon !== 'folder') return file

    const childFile = findReadableFile(file.children ?? [], fileId)
    if (childFile) return childFile
  }
}

function countReadableFiles(files: AgentFileNode[]): number {
  return files.reduce((count, file) => {
    if (file.icon === 'folder') return count + countReadableFiles(file.children ?? [])

    return count + 1
  }, 0)
}

async function isNoActiveBindingError(error: unknown) {
  if (!(error instanceof Response) || error.status !== 404) return false

  try {
    const payload = (await error.clone().json()) as SandboxErrorPayload
    return payload.code === 'no_active_binding'
  } catch {
    return false
  }
}

const isNotFoundResponse = (error: unknown) => error instanceof Response && error.status === 404

export function AgentWorkingDirectoryPanel({
  source,
  onOpenChange,
  open,
}: AgentWorkingDirectoryPanelProps) {
  const { t } = useTranslation('agentV2')
  const { t: tCommon } = useTranslation('common')
  const persistentFilesTooltip = t(
    ($) => $['agentDetail.configure.workingDirectory.persistentFilesTooltip'],
  )
  const temporaryFilesTooltip = t(
    ($) => $['agentDetail.configure.workingDirectory.temporaryFilesTooltip'],
  )
  const [selectedDirectoryPath, setSelectedDirectoryPath] = useState<AgentWorkingDirectoryPath>(
    AGENT_SAVED_FILES_ROOT_PATH,
  )
  const [selectedFileId, setSelectedFileId] = useState<string>()
  const [loadedFolderPaths, setLoadedFolderPaths] = useState<string[]>([])
  const [openFolderPaths, setOpenFolderPaths] = useState<string[]>([])
  const [pendingOpenFolderPaths, setPendingOpenFolderPaths] = useState<string[]>([])
  const [downloadActionLoadingTarget, setDownloadActionLoadingTarget] =
    useState<AgentSkillDetailDownloadAction | null>(null)
  const directoryPath = selectedDirectoryPath
  const selectedRootPath = getSandboxRootPath(directoryPath)
  const getFileListQueryOptions = (path: string) =>
    source.type === 'agent'
      ? consoleQuery.agent.byAgentId.sandbox.files.get.queryOptions({
          input: {
            params: {
              agent_id: source.agentId,
            },
            query: {
              caller_type: source.callerType,
              caller_id: source.callerId,
              path: toSandboxApiPath(path),
            },
          },
          context: {
            silent: true,
          },
        })
      : consoleQuery.apps.byAppId.workflowRuns.byWorkflowRunId.agentNodes.byNodeId.sandbox.files.get.queryOptions(
          {
            input: {
              params: {
                app_id: source.appId,
                workflow_run_id: source.workflowRunId,
                node_id: source.nodeId,
              },
              query: {
                node_execution_id: source.nodeExecutionId,
                path: toSandboxApiPath(path),
              },
            },
            context: {
              silent: true,
            },
          },
        )
  const handleDirectoryPathChange = (path: AgentWorkingDirectoryPath) => {
    setSelectedDirectoryPath(path)
    setSelectedFileId(undefined)
    setLoadedFolderPaths([])
    setOpenFolderPaths([])
    setPendingOpenFolderPaths([])
  }
  const fileListQueryOptions = getFileListQueryOptions(directoryPath)
  const fileListQuery = useQuery({
    ...fileListQueryOptions,
    queryFn: async (context): Promise<SandboxListResponse> => {
      try {
        return await fileListQueryOptions.queryFn(context)
      } catch (error) {
        if (await isNoActiveBindingError(error)) {
          return {
            entries: [],
            path: '.',
          }
        }

        throw error
      }
    },
    retry: false,
  })
  const expandedFolderQueries = useQueries({
    queries: loadedFolderPaths.map((path) => {
      const queryOptions = getFileListQueryOptions(path)

      return {
        ...queryOptions,
        queryFn: async (context): Promise<SandboxListResponse> => {
          try {
            return await queryOptions.queryFn(context)
          } catch (error) {
            if (await isNoActiveBindingError(error)) {
              return {
                entries: [],
                path,
              }
            }

            throw error
          }
        },
        retry: false,
      }
    }),
  })
  const workingDirectoryFiles = expandedFolderQueries.reduce(
    (files, query, index) => {
      return mergeSandboxFileTree(
        files,
        buildSandboxFileTree(query.data?.entries, loadedFolderPaths[index], {
          nestRootPath: directoryPath,
          nestUnderBasePath: true,
        }),
      )
    },
    buildSandboxFileTree(fileListQuery.data?.entries, directoryPath),
  )
  const selectedWorkingDirectoryFile =
    findReadableFile(workingDirectoryFiles, selectedFileId) ??
    findFirstReadableFile(workingDirectoryFiles)
  const isFileListLoading = fileListQuery.isPending
  const loadingFolderPaths = new Set(
    loadedFolderPaths.filter((path, index) => expandedFolderQueries[index]?.isPending),
  )
  const loadedFolderPathIndexes = new Map(loadedFolderPaths.map((path, index) => [path, index]))
  const fileReadQueryOptions =
    source.type === 'agent'
      ? consoleQuery.agent.byAgentId.sandbox.files.read.get.queryOptions({
          input: selectedWorkingDirectoryFile?.id
            ? {
                params: {
                  agent_id: source.agentId,
                },
                query: {
                  caller_type: source.callerType,
                  caller_id: source.callerId,
                  path: toSandboxApiPath(selectedWorkingDirectoryFile.id),
                },
              }
            : skipToken,
          context: {
            silent: true,
          },
        })
      : consoleQuery.apps.byAppId.workflowRuns.byWorkflowRunId.agentNodes.byNodeId.sandbox.files.read.get.queryOptions(
          {
            input: selectedWorkingDirectoryFile?.id
              ? {
                  params: {
                    app_id: source.appId,
                    workflow_run_id: source.workflowRunId,
                    node_id: source.nodeId,
                  },
                  query: {
                    node_execution_id: source.nodeExecutionId,
                    path: toSandboxApiPath(selectedWorkingDirectoryFile.id),
                  },
                }
              : skipToken,
            context: {
              silent: true,
            },
          },
        )
  const fileReadQuery = useQuery({
    ...fileReadQueryOptions,
    enabled:
      open && !!selectedWorkingDirectoryFile && selectedWorkingDirectoryFile.icon !== 'image',
    queryFn: async (context): Promise<SandboxReadResponse> => {
      try {
        return await fileReadQueryOptions.queryFn(context)
      } catch (error) {
        if (isNotFoundResponse(error)) {
          return {
            binary: false,
            path: selectedWorkingDirectoryFile?.id ?? '',
            text: null,
            truncated: false,
          }
        }

        throw error
      }
    },
    retry: false,
  })
  const agentSandboxDownloadMutation = useMutation(
    consoleQuery.agent.byAgentId.sandbox.files.download.post.mutationOptions(),
  )
  const workflowSandboxDownloadMutation = useMutation(
    consoleQuery.apps.byAppId.workflowRuns.byWorkflowRunId.agentNodes.byNodeId.sandbox.files.download.post.mutationOptions(),
  )
  const { mutateAsync: downloadAgentSandboxFile } = agentSandboxDownloadMutation
  const isImagePreviewFile = selectedWorkingDirectoryFile?.icon === 'image'
  const selectedWorkingDirectoryFilePath = selectedWorkingDirectoryFile?.id
  const { mutateAsync: downloadWorkflowSandboxFile } = workflowSandboxDownloadMutation
  const isFileDownloadPending =
    agentSandboxDownloadMutation.isPending || workflowSandboxDownloadMutation.isPending
  const isFileReadLoading =
    !!selectedWorkingDirectoryFile && !isImagePreviewFile && fileReadQuery.isPending
  const imagePreviewQuery = useQuery({
    queryKey: [
      'agent-v2',
      'working-directory',
      'image-preview',
      source.type,
      source.type === 'agent' ? source.agentId : source.appId,
      source.type === 'agent' ? source.callerType : source.workflowRunId,
      source.type === 'agent' ? source.callerId : source.nodeId,
      source.type === 'workflow-node' ? source.nodeExecutionId : undefined,
      selectedWorkingDirectoryFilePath,
    ],
    queryFn: async () => {
      if (!selectedWorkingDirectoryFilePath)
        throw new Error('Missing selected working directory file')

      if (source.type === 'agent') {
        return consoleClient.agent.byAgentId.sandbox.files.download.post({
          params: {
            agent_id: source.agentId,
          },
          body: {
            caller_type: source.callerType,
            caller_id: source.callerId,
            path: toSandboxApiPath(selectedWorkingDirectoryFilePath),
          },
        })
      }

      return consoleClient.apps.byAppId.workflowRuns.byWorkflowRunId.agentNodes.byNodeId.sandbox.files.download.post(
        {
          params: {
            app_id: source.appId,
            workflow_run_id: source.workflowRunId,
            node_id: source.nodeId,
          },
          body: {
            node_execution_id: source.nodeExecutionId,
            path: toSandboxApiPath(selectedWorkingDirectoryFilePath),
          },
        },
      )
    },
    enabled: open && !!selectedWorkingDirectoryFile && isImagePreviewFile,
  })
  const handleDownloadFile = useCallback(
    async (action: AgentSkillDetailDownloadAction) => {
      if (!selectedWorkingDirectoryFile || isFileDownloadPending) return

      if (source.type === 'agent') {
        setDownloadActionLoadingTarget(action)
        try {
          const result = await downloadAgentSandboxFile({
            params: {
              agent_id: source.agentId,
            },
            body: {
              caller_type: source.callerType,
              caller_id: source.callerId,
              path: toSandboxApiPath(selectedWorkingDirectoryFile.id),
            },
          })
          downloadUrl({ url: result.url, fileName: selectedWorkingDirectoryFile.name })
          toast.success(tCommon(($) => $['operation.downloadSuccess']))
        } catch {
          // The generated client reports the mutation failure through its shared error handler.
        } finally {
          setDownloadActionLoadingTarget(null)
        }
        return
      }

      setDownloadActionLoadingTarget(action)
      try {
        const result = await downloadWorkflowSandboxFile({
          params: {
            app_id: source.appId,
            workflow_run_id: source.workflowRunId,
            node_id: source.nodeId,
          },
          body: {
            node_execution_id: source.nodeExecutionId,
            path: toSandboxApiPath(selectedWorkingDirectoryFile.id),
          },
        })
        downloadUrl({ url: result.url, fileName: selectedWorkingDirectoryFile.name })
        toast.success(tCommon(($) => $['operation.downloadSuccess']))
      } catch {
        // The generated client reports the mutation failure through its shared error handler.
      } finally {
        setDownloadActionLoadingTarget(null)
      }
    },
    [
      isFileDownloadPending,
      selectedWorkingDirectoryFile,
      source,
      tCommon,
      downloadAgentSandboxFile,
      downloadWorkflowSandboxFile,
    ],
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <AgentSkillDetailDialog
        skillName={t(($) => $['agentDetail.configure.workingDirectory.title'])}
        detail={{
          description: t(($) => $['agentDetail.configure.workingDirectory.description']),
          fileCount: countReadableFiles(workingDirectoryFiles),
          fileListHeader: (
            <div className="flex shrink-0 flex-col">
              <h3
                id="agent-skill-detail-files-heading"
                className="px-4 pt-3.5 pb-2 system-xl-semibold text-text-primary"
              >
                {t(($) => $['agentDetail.configure.workingDirectory.fileSystem'])}
              </h3>
              <Tabs
                value={selectedRootPath}
                onValueChange={(path) =>
                  handleDirectoryPathChange(path as AgentWorkingDirectoryPath)
                }
              >
                <TabsList className="relative h-9 gap-4 border-b-[0.5px] border-divider-regular px-4">
                  <div className="flex h-full items-center gap-0.5">
                    <TabsTab
                      value={AGENT_SAVED_FILES_ROOT_PATH}
                      className="h-full min-w-0 pt-0 pb-0 system-sm-semibold data-active:border-transparent"
                    >
                      {t(($) => $['agentDetail.configure.workingDirectory.persistentFiles'])}
                    </TabsTab>
                    <Infotip
                      aria-label={persistentFilesTooltip}
                      iconVariant="information"
                      popupClassName="w-64"
                    >
                      {persistentFilesTooltip}
                    </Infotip>
                  </div>
                  <div className="flex h-full items-center gap-0.5">
                    <TabsTab
                      value={AGENT_TEMPORARY_FILES_ROOT_PATH}
                      className="h-full min-w-0 pt-0 pb-0 system-sm-semibold data-active:border-transparent"
                    >
                      {t(($) => $['agentDetail.configure.workingDirectory.temporaryFiles'])}
                    </TabsTab>
                    <Infotip
                      aria-label={temporaryFilesTooltip}
                      iconVariant="information"
                      popupClassName="w-64"
                    >
                      {temporaryFilesTooltip}
                    </Infotip>
                  </div>
                  <TabsIndicator
                    className="pointer-events-none absolute bottom-0 left-0 h-0 border-b-2 border-components-tab-active transition-[translate,width] duration-150 ease-in-out motion-reduce:transition-none"
                    style={{
                      translate: 'var(--active-tab-left)',
                      width: 'var(--active-tab-width)',
                    }}
                  />
                </TabsList>
                <TabsPanel value={AGENT_SAVED_FILES_ROOT_PATH} tabIndex={-1}>
                  <AgentWorkingDirectoryBreadcrumb
                    path={directoryPath}
                    onPathChange={handleDirectoryPathChange}
                  />
                </TabsPanel>
                <TabsPanel value={AGENT_TEMPORARY_FILES_ROOT_PATH} tabIndex={-1}>
                  <AgentWorkingDirectoryBreadcrumb
                    path={directoryPath}
                    onPathChange={handleDirectoryPathChange}
                  />
                </TabsPanel>
              </Tabs>
            </div>
          ),
          fileListPanelClassName: 'w-[360px]',
          fileListTreeClassName: 'px-0',
          fileListTreeListClassName: 'px-1',
          fileListTitle: t(($) => $['agentDetail.configure.workingDirectory.title']),
          files: workingDirectoryFiles,
          filePreview: {
            binary: fileReadQuery.data?.binary,
            content: fileReadQuery.data?.text ?? undefined,
            downloadActionLoadingTarget,
            downloadUrl: imagePreviewQuery.data?.url,
            fileName: isFileListLoading ? '' : selectedWorkingDirectoryFile?.name,
            isDownloadError: imagePreviewQuery.isError,
            isDownloadLoading: !!isImagePreviewFile && imagePreviewQuery.isPending,
            isError: fileListQuery.isError || fileReadQuery.isError,
            isImage: isImagePreviewFile,
            isLoading: isFileListLoading || isFileReadLoading,
          },
          onDownloadFile: selectedWorkingDirectoryFile ? handleDownloadFile : undefined,
          folderOpenState: ({ file }) => {
            const queryIndex = loadedFolderPathIndexes.get(file.id)
            const folderLoaded =
              queryIndex !== undefined && expandedFolderQueries[queryIndex]?.isSuccess

            return (
              openFolderPaths.includes(file.id) ||
              (pendingOpenFolderPaths.includes(file.id) && !!folderLoaded)
            )
          },
          onFolderOpenChange: ({ file, open }) => {
            if (loadingFolderPaths.has(file.id)) return

            if (open && !loadedFolderPaths.includes(file.id)) {
              setLoadedFolderPaths((paths) => [...paths, file.id])
              setPendingOpenFolderPaths((paths) =>
                paths.includes(file.id) ? paths : [...paths, file.id],
              )
              return
            }

            setPendingOpenFolderPaths((paths) => paths.filter((path) => path !== file.id))
            setOpenFolderPaths((paths) =>
              open
                ? paths.includes(file.id)
                  ? paths
                  : [...paths, file.id]
                : paths.filter((path) => path !== file.id),
            )
          },
          onFolderDoubleClick: ({ file }) => handleDirectoryPathChange(file.id),
          onSelectFile: (selectedFile) => setSelectedFileId(selectedFile.id),
          renderFolderSuffix: ({ file }) =>
            loadingFolderPaths.has(file.id) ? (
              <span
                aria-label={tCommon(($) => $.loading)}
                className="ms-auto i-ri-loader-4-line size-4 shrink-0 animate-spin text-text-tertiary"
              />
            ) : null,
          selectedFileId: selectedWorkingDirectoryFile?.id,
          sections: [],
        }}
      />
    </Dialog>
  )
}
