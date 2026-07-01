'use client'

import type { SandboxFileEntryResponse, SandboxListResponse, SandboxReadResponse } from '@dify/contracts/api/console/agent/types.gen'
import type { AgentWorkingDirectoryPath } from './working-directory-breadcrumb'
import type { AgentFileNode } from '@/features/agent-v2/agent-composer/form-state'
import { Dialog } from '@langgenius/dify-ui/dialog'
import { skipToken, useQueries, useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { consoleQuery } from '@/service/client'
import { getFileIconType } from '../orchestrate/files/file-icon'
import { AgentSkillDetailDialog } from '../orchestrate/skills/detail-dialog'
import { AgentWorkingDirectoryBreadcrumb } from './working-directory-breadcrumb'

type AgentWorkingDirectoryPanelProps = {
  source: AgentWorkingDirectorySource
  onOpenChange: (open: boolean) => void
  open: boolean
}

export type AgentWorkingDirectorySource = {
  type: 'agent'
  agentId: string
  conversationId?: string | null
} | {
  type: 'workflow-node'
  appId?: string
  conversationId?: string | null
  nodeId: string
  workflowRunId?: string | null
}

type SandboxErrorPayload = {
  code?: string
}

const normalizeSandboxPath = (path: string) => {
  const normalizedPath = path.replace(/^\.\//, '').replace(/^\/+|\/+$/g, '')
  return normalizedPath === '.' ? '' : normalizedPath
}

const joinSandboxPath = (basePath: string, name: string) => {
  const normalizedBasePath = normalizeSandboxPath(basePath)
  return normalizedBasePath ? `${normalizedBasePath}/${name}` : name
}

function getSandboxEntryRelativePathSegments(entryName: string, basePath: string) {
  const normalizedBasePath = normalizeSandboxPath(basePath)
  const normalizedEntryName = normalizeSandboxPath(entryName)

  if (!normalizedEntryName)
    return []

  if (!normalizedBasePath)
    return normalizedEntryName.split('/').filter(Boolean)

  if (normalizedEntryName === normalizedBasePath)
    return []

  if (normalizedEntryName.startsWith(`${normalizedBasePath}/`))
    return normalizedEntryName.slice(normalizedBasePath.length + 1).split('/').filter(Boolean)

  return normalizedEntryName.split('/').filter(Boolean)
}

function buildSandboxFileTree(entries: SandboxFileEntryResponse[] = [], basePath = '.'): AgentFileNode[] {
  const rootFiles: AgentFileNode[] = []
  const normalizedBasePath = normalizeSandboxPath(basePath)

  for (const entry of entries) {
    const pathSegments = getSandboxEntryRelativePathSegments(entry.name, basePath)
    if (!pathSegments.length)
      continue

    let currentFiles = rootFiles
    let currentPath = normalizedBasePath

    pathSegments.forEach((segment, index) => {
      const isLeaf = index === pathSegments.length - 1
      const isFolder = !isLeaf || entry.type === 'dir'
      const nodePath = joinSandboxPath(currentPath, segment)
      let node = currentFiles.find(file => file.id === nodePath)

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

function mergeSandboxFileTree(targetFiles: AgentFileNode[], sourceFiles: AgentFileNode[]): AgentFileNode[] {
  const mergedFiles = [...targetFiles]

  for (const sourceFile of sourceFiles) {
    const targetFileIndex = mergedFiles.findIndex(file => file.id === sourceFile.id)
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
      if (childFile)
        return childFile
    }
    else if (file.icon !== 'folder') {
      return file
    }
  }
}

function findReadableFile(files: AgentFileNode[], fileId?: string): AgentFileNode | undefined {
  if (!fileId)
    return undefined

  for (const file of files) {
    if (file.id === fileId && file.icon !== 'folder')
      return file

    const childFile = findReadableFile(file.children ?? [], fileId)
    if (childFile)
      return childFile
  }
}

function countReadableFiles(files: AgentFileNode[]): number {
  return files.reduce((count, file) => {
    if (file.icon === 'folder')
      return count + countReadableFiles(file.children ?? [])

    return count + 1
  }, 0)
}

async function isNoActiveSessionError(error: unknown) {
  if (!(error instanceof Response) || error.status !== 404)
    return false

  try {
    const payload = await error.clone().json() as SandboxErrorPayload
    return payload.code === 'no_active_session'
  }
  catch {
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
  const [directoryPath, setDirectoryPath] = useState<AgentWorkingDirectoryPath>('.')
  const [selectedFileId, setSelectedFileId] = useState<string>()
  const [loadedFolderPaths, setLoadedFolderPaths] = useState<string[]>([])
  const [openFolderPaths, setOpenFolderPaths] = useState<string[]>([])
  const [pendingOpenFolderPaths, setPendingOpenFolderPaths] = useState<string[]>([])
  const workflowNodeRunId = source.type === 'workflow-node'
    ? (source.workflowRunId ?? source.conversationId)
    : undefined
  const hasWorkingDirectorySource = source.type === 'agent'
    ? !!source.conversationId
    : !!source.appId && !!workflowNodeRunId
  const getFileListQueryOptions = (path: string) => source.type === 'agent'
    ? consoleQuery.agent.byAgentId.sandbox.files.get.queryOptions({
        input: source.conversationId
          ? {
              params: {
                agent_id: source.agentId,
              },
              query: {
                conversation_id: source.conversationId,
                path,
              },
            }
          : skipToken,
        context: {
          silent: true,
        },
      })
    : consoleQuery.apps.byAppId.workflowRuns.byWorkflowRunId.agentNodes.byNodeId.sandbox.files.get.queryOptions({
        input: source.appId && workflowNodeRunId
          ? {
              params: {
                app_id: source.appId,
                workflow_run_id: workflowNodeRunId,
                node_id: source.nodeId,
              },
              query: {
                path,
              },
            }
          : skipToken,
        context: {
          silent: true,
        },
      })
  const handleDirectoryPathChange = (path: AgentWorkingDirectoryPath) => {
    setDirectoryPath(path)
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
      }
      catch (error) {
        if (await isNoActiveSessionError(error)) {
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
    queries: hasWorkingDirectorySource
      ? loadedFolderPaths.map((path) => {
          const queryOptions = getFileListQueryOptions(path)

          return {
            ...queryOptions,
            queryFn: async (context): Promise<SandboxListResponse> => {
              try {
                return await queryOptions.queryFn(context)
              }
              catch (error) {
                if (await isNoActiveSessionError(error)) {
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
        })
      : [],
  })
  const workingDirectoryFiles = expandedFolderQueries.reduce((files, query) => {
    return mergeSandboxFileTree(files, buildSandboxFileTree(query.data?.entries, query.data?.path))
  }, buildSandboxFileTree(fileListQuery.data?.entries, fileListQuery.data?.path))
  const selectedWorkingDirectoryFile = findReadableFile(workingDirectoryFiles, selectedFileId)
    ?? findFirstReadableFile(workingDirectoryFiles)
  const isFileListLoading = hasWorkingDirectorySource && fileListQuery.isPending
  const loadingFolderPaths = new Set(loadedFolderPaths.filter((path, index) => expandedFolderQueries[index]?.isPending))
  const loadedFolderPathIndexes = new Map(loadedFolderPaths.map((path, index) => [path, index]))
  const fileReadQueryOptions = source.type === 'agent'
    ? consoleQuery.agent.byAgentId.sandbox.files.read.get.queryOptions({
        input: source.conversationId && selectedWorkingDirectoryFile?.id
          ? {
              params: {
                agent_id: source.agentId,
              },
              query: {
                conversation_id: source.conversationId,
                path: selectedWorkingDirectoryFile.id,
              },
            }
          : skipToken,
        context: {
          silent: true,
        },
      })
    : consoleQuery.apps.byAppId.workflowRuns.byWorkflowRunId.agentNodes.byNodeId.sandbox.files.read.get.queryOptions({
        input: source.appId && workflowNodeRunId && selectedWorkingDirectoryFile?.id
          ? {
              params: {
                app_id: source.appId,
                workflow_run_id: workflowNodeRunId,
                node_id: source.nodeId,
              },
              query: {
                path: selectedWorkingDirectoryFile.id,
              },
            }
          : skipToken,
        context: {
          silent: true,
        },
      })
  const fileReadQuery = useQuery({
    ...fileReadQueryOptions,
    enabled: open && !!selectedWorkingDirectoryFile,
    queryFn: async (context): Promise<SandboxReadResponse> => {
      try {
        return await fileReadQueryOptions.queryFn(context)
      }
      catch (error) {
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
  const isFileReadLoading = !!selectedWorkingDirectoryFile && fileReadQuery.isPending

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <AgentSkillDetailDialog
        skillName={t('agentDetail.configure.workingDirectory.title')}
        detail={{
          description: t('agentDetail.configure.workingDirectory.description'),
          fileCount: countReadableFiles(workingDirectoryFiles),
          fileListHeader: (
            <div className="flex shrink-0 flex-col">
              <div className="flex items-center gap-1 px-4 pt-3.5 pb-3">
                <h3 id="agent-skill-detail-files-heading" className="system-xl-semibold text-text-primary">
                  {t('agentDetail.configure.workingDirectory.fileSystem')}
                </h3>
              </div>
              <AgentWorkingDirectoryBreadcrumb
                path={directoryPath}
                onPathChange={handleDirectoryPathChange}
              />
            </div>
          ),
          fileListPanelClassName: 'w-[360px]',
          fileListTreeClassName: 'px-0',
          fileListTreeListClassName: 'px-1',
          fileListTitle: t('agentDetail.configure.workingDirectory.title'),
          files: workingDirectoryFiles,
          filePreview: {
            binary: fileReadQuery.data?.binary,
            content: fileReadQuery.data?.text ?? undefined,
            fileName: isFileListLoading ? '' : selectedWorkingDirectoryFile?.name,
            isError: fileListQuery.isError || fileReadQuery.isError,
            isLoading: isFileListLoading || isFileReadLoading,
          },
          folderOpenState: ({ file }) => {
            const queryIndex = loadedFolderPathIndexes.get(file.id)
            const folderLoaded = queryIndex !== undefined && expandedFolderQueries[queryIndex]?.isSuccess

            return openFolderPaths.includes(file.id)
              || (pendingOpenFolderPaths.includes(file.id) && !!folderLoaded)
          },
          onFolderOpenChange: ({ file, open }) => {
            if (loadingFolderPaths.has(file.id))
              return

            if (open && !loadedFolderPaths.includes(file.id)) {
              setLoadedFolderPaths(paths => [...paths, file.id])
              setPendingOpenFolderPaths(paths => paths.includes(file.id) ? paths : [...paths, file.id])
              return
            }

            setPendingOpenFolderPaths(paths => paths.filter(path => path !== file.id))
            setOpenFolderPaths(paths => open
              ? (paths.includes(file.id) ? paths : [...paths, file.id])
              : paths.filter(path => path !== file.id))
          },
          onFolderDoubleClick: ({ file }) => handleDirectoryPathChange(file.id),
          onSelectFile: selectedFile => setSelectedFileId(selectedFile.id),
          renderFolderSuffix: ({ file }) => loadingFolderPaths.has(file.id)
            ? (
                <span aria-label={tCommon('loading')} className="ms-auto i-ri-loader-4-line size-4 shrink-0 animate-spin text-text-tertiary" />
              )
            : null,
          selectedFileId: selectedWorkingDirectoryFile?.id,
          sections: [],
        }}
      />
    </Dialog>
  )
}
