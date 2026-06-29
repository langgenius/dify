'use client'

import type { SandboxFileEntryResponse, SandboxListResponse } from '@dify/contracts/api/console/agent/types.gen'
import type { AgentFileNode } from '@/features/agent-v2/agent-composer/form-state'
import {
  Drawer,
  DrawerBackdrop,
  DrawerCloseButton,
  DrawerContent,
  DrawerDescription,
  DrawerPopup,
  DrawerPortal,
  DrawerTitle,
  DrawerViewport,
} from '@langgenius/dify-ui/drawer'
import { FileTreeFile } from '@langgenius/dify-ui/file-tree'
import { skipToken, useQueries, useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import Loading from '@/app/components/base/loading'
import { consoleQuery } from '@/service/client'
import { getFileIconType } from '../orchestrate/files/file-icon'
import { AgentFileTree } from '../orchestrate/files/tree'

type AgentWorkingDirectoryPanelProps = {
  agentId: string
  conversationId?: string | null
  onOpenChange: (open: boolean) => void
  open: boolean
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

function buildSandboxFileTree(entries: SandboxFileEntryResponse[] = [], basePath = '.'): AgentFileNode[] {
  const rootFiles: AgentFileNode[] = []

  for (const entry of entries) {
    const pathSegments = entry.name.split('/').filter(Boolean)
    if (!pathSegments.length)
      continue

    let currentFiles = rootFiles
    let currentPath = normalizeSandboxPath(basePath)

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
          driveKey: nodePath,
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

export function AgentWorkingDirectoryPanel({
  agentId,
  conversationId,
  onOpenChange,
  open,
}: AgentWorkingDirectoryPanelProps) {
  const { t } = useTranslation('agentV2')
  const { t: tCommon } = useTranslation('common')
  const [selectedFileId, setSelectedFileId] = useState<string>()
  const [loadedFolderPaths, setLoadedFolderPaths] = useState<string[]>([])
  const [openFolderPaths, setOpenFolderPaths] = useState<string[]>([])
  const getFileListQueryOptions = (path: string) => consoleQuery.agent.byAgentId.sandbox.files.get.queryOptions({
    input: conversationId
      ? {
          params: {
            agent_id: agentId,
          },
          query: {
            conversation_id: conversationId,
            path,
          },
        }
      : skipToken,
    context: {
      silent: true,
    },
  })
  const fileListQueryOptions = getFileListQueryOptions('.')
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
    queries: conversationId
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
  const selectedWorkingDirectoryFileId = findReadableFile(workingDirectoryFiles, selectedFileId)?.id
    ?? findFirstReadableFile(workingDirectoryFiles)?.id
  const isFileListLoading = !!conversationId && fileListQuery.isPending
  const loadingFolderPaths = new Set(loadedFolderPaths.filter((path, index) => expandedFolderQueries[index]?.isPending))
  const fileReadQuery = useQuery(consoleQuery.agent.byAgentId.sandbox.files.read.get.queryOptions({
    input: conversationId && selectedWorkingDirectoryFileId
      ? {
          params: {
            agent_id: agentId,
          },
          query: {
            conversation_id: conversationId,
            path: selectedWorkingDirectoryFileId,
          },
        }
      : skipToken,
  }))

  return (
    <Drawer open={open} onOpenChange={onOpenChange} swipeDirection="right">
      <DrawerPortal>
        <DrawerBackdrop forceRender className="fixed bg-transparent" />
        <DrawerViewport>
          <DrawerPopup className="data-[swipe-direction=right]:top-2 data-[swipe-direction=right]:bottom-2 data-[swipe-direction=right]:h-auto data-[swipe-direction=right]:w-[360px]">
            <DrawerContent className="flex min-h-0 flex-1 flex-col p-0 pb-0">
              <div className="flex shrink-0 items-start gap-2 px-4 pt-3 pb-2">
                <div className="min-w-0 flex-1">
                  <DrawerTitle className="truncate system-xl-semibold text-text-primary">
                    {t('agentDetail.configure.workingDirectory.title')}
                  </DrawerTitle>
                  <DrawerDescription className="body-xs-regular text-text-tertiary">
                    {t('agentDetail.configure.workingDirectory.description')}
                  </DrawerDescription>
                </div>
                <DrawerCloseButton
                  aria-label={tCommon('operation.close')}
                  className="size-6 rounded-md p-0.5"
                />
              </div>
              <div className="flex min-h-0 flex-1 flex-col">
                {isFileListLoading
                  ? (
                      <div className="flex min-h-0 flex-1 items-center justify-center">
                        <Loading type="area" />
                      </div>
                    )
                  : fileListQuery.isError
                    ? (
                        <div className="flex min-h-0 flex-1 items-center justify-center px-6 text-center system-sm-regular text-text-tertiary">
                          {t('agentDetail.configure.files.preview.failed')}
                        </div>
                      )
                    : workingDirectoryFiles.length
                      ? (
                          <AgentFileTree
                            files={workingDirectoryFiles}
                            selectedFileId={selectedWorkingDirectoryFileId}
                            treeLabel={t('agentDetail.configure.workingDirectory.treeLabel')}
                            className="min-h-0 flex-1 px-3 py-1"
                            scrollAreaClassName="flex-1"
                            rootClassName="p-0"
                            listClassName="gap-px"
                            folderOpenState={({ file }) => openFolderPaths.includes(file.id)}
                            onFolderOpenChange={({ file, open }) => {
                              if (loadingFolderPaths.has(file.id))
                                return

                              if (open && !loadedFolderPaths.includes(file.id)) {
                                setLoadedFolderPaths(paths => [...paths, file.id])
                                return
                              }

                              setOpenFolderPaths(paths => open
                                ? (paths.includes(file.id) ? paths : [...paths, file.id])
                                : paths.filter(path => path !== file.id))
                            }}
                            renderFile={({ file, selected, children }) => (
                              <FileTreeFile
                                disabled={file.icon === 'folder'}
                                selected={selected}
                                onClick={() => setSelectedFileId(file.id)}
                              >
                                {children}
                                {selected && (
                                  <span aria-hidden className="ms-auto i-ri-more-fill flex size-5 shrink-0 items-center justify-center text-text-tertiary" />
                                )}
                              </FileTreeFile>
                            )}
                            renderFolderPanel={({ file }) => loadingFolderPaths.has(file.id)
                              ? (
                                  <div className="px-7 py-1 system-xs-regular text-text-tertiary">
                                    {tCommon('loading')}
                                  </div>
                                )
                              : null}
                          />
                        )
                      : (
                          <div className="flex min-h-0 flex-1 items-center justify-center px-6 text-center system-sm-regular text-text-tertiary">
                            {tCommon('noData')}
                          </div>
                        )}
                {selectedWorkingDirectoryFileId && (
                  <div className="max-h-40 shrink-0 border-t border-divider-subtle p-3">
                    <div className="mb-2 truncate system-xs-semibold text-text-secondary">
                      {selectedWorkingDirectoryFileId}
                    </div>
                    {fileReadQuery.isPending
                      ? <Loading type="area" />
                      : fileReadQuery.isError
                        ? (
                            <p className="system-sm-regular text-text-tertiary">
                              {t('agentDetail.configure.files.preview.failed')}
                            </p>
                          )
                        : fileReadQuery.data?.text
                          ? (
                              <pre className="max-h-24 overflow-auto rounded-md bg-background-section p-2 system-xs-regular break-words whitespace-pre-wrap text-text-secondary">
                                {fileReadQuery.data.text}
                              </pre>
                            )
                          : (
                              <p className="system-sm-regular text-text-tertiary">
                                {t('agentDetail.configure.files.preview.empty')}
                              </p>
                            )}
                  </div>
                )}
              </div>
            </DrawerContent>
          </DrawerPopup>
        </DrawerViewport>
      </DrawerPortal>
    </Drawer>
  )
}
