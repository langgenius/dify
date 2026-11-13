'use client'

import type { AgentConfigSkillFileResponse } from '@dify/contracts/api/console/agent/types.gen'
import type { AgentConfigApiContext } from '../config-context'
import type { AgentSkillDetail, AgentSkillDetailDownloadAction } from './detail-dialog'
import type { AgentFileNode, AgentSkill } from '@/features/agent-v2/agent-composer/form-state'
import { queryOptions, skipToken, useQuery, useQueryClient } from '@tanstack/react-query'
import Cookies from 'js-cookie'
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from '@/app/notifications'
import { API_PREFIX, CSRF_COOKIE_NAME, CSRF_HEADER_NAME } from '@/config'
import { getDriveFileIconType, hasFileDataPreview } from '@/features/agent-v2/file-icon'
import { consoleQuery } from '@/service/console'
import { downloadBlob } from '@/utils/download'
import { getErrorMessage } from '@/utils/error-message'

const skillFileContentQueryKey = (url?: string) => ['agent-v2', 'skill-file-content', url] as const

const resolveSkillFileContentUrl = (url: string) => {
  const consoleApiUrl = new URL(API_PREFIX, globalThis.location.origin)
  const consoleApiBaseUrl = consoleApiUrl.href.endsWith('/')
    ? consoleApiUrl
    : new URL(`${consoleApiUrl.href}/`)

  return new URL(url, consoleApiBaseUrl).toString()
}

const fetchSkillFileContent = async (url: string) => {
  const response = await globalThis.fetch(resolveSkillFileContentUrl(url), {
    credentials: 'include',
    headers: {
      [CSRF_HEADER_NAME]: Cookies.get(CSRF_COOKIE_NAME()) || '',
    },
  })
  if (!response.ok) throw new Error(`Failed to download skill file: ${response.status}`)

  return response.blob()
}

const getSkillFileContentQueryOptions = (url: string) =>
  queryOptions({
    queryKey: skillFileContentQueryKey(url),
    queryFn: () => fetchSkillFileContent(url),
    staleTime: 0,
    refetchOnWindowFocus: false,
  })

const isSkillFolder = (file: AgentConfigSkillFileResponse) => file.type === 'directory'

const toSkillFileNode = (item: AgentConfigSkillFileResponse): AgentFileNode => {
  const fileName = item.name || item.path.split('/').pop() || item.path

  return {
    id: item.path,
    name: fileName,
    configName: item.path,
    icon: isSkillFolder(item)
      ? 'folder'
      : getDriveFileIconType({
          fileKind: undefined,
          fileName,
          mimeType: undefined,
        }),
  }
}

const sortSkillFileNodes = (files: AgentFileNode[]): AgentFileNode[] =>
  [...files]
    .sort((first, second) => {
      const firstIsFolder = first.icon === 'folder'
      const secondIsFolder = second.icon === 'folder'

      if (firstIsFolder !== secondIsFolder) return firstIsFolder ? -1 : 1

      return first.name.localeCompare(second.name)
    })
    .map((file) =>
      file.children ? { ...file, children: sortSkillFileNodes(file.children) } : file,
    )

const toSkillFileTree = (files: AgentConfigSkillFileResponse[]): AgentFileNode[] => {
  const root: AgentFileNode[] = []
  const folders = new Map<string, AgentFileNode>()

  for (const file of files) {
    const relativePath = file.path.split('/').filter(Boolean).join('/')
    if (!relativePath) continue

    const segments = relativePath.split('/').filter(Boolean)
    let siblings = root
    let currentPath = ''

    segments.forEach((segment, index) => {
      currentPath = currentPath ? `${currentPath}/${segment}` : segment
      const isLeaf = index === segments.length - 1
      const isFolder = !isLeaf || isSkillFolder(file)

      if (isFolder) {
        const existingFolder = folders.get(currentPath)
        if (existingFolder) {
          siblings = existingFolder.children ?? []
          return
        }

        const folder: AgentFileNode = {
          icon: 'folder',
          id: currentPath,
          name: segment,
          children: [],
        }
        folders.set(currentPath, folder)
        siblings.push(folder)
        siblings = folder.children ?? []
        return
      }

      siblings.push({
        ...toSkillFileNode(file),
        name: segment,
      })
    })
  }

  return sortSkillFileNodes(root)
}

const countSkillPackageFiles = (files: AgentConfigSkillFileResponse[] | undefined) => {
  const filePaths = new Set<string>()

  for (const file of files ?? []) {
    if (isSkillFolder(file)) continue

    const relativePath = file.path.split('/').filter(Boolean).join('/')
    if (!relativePath) continue

    filePaths.add(relativePath)
  }

  return filePaths.size
}

const getSkillMdFileId = (files: AgentFileNode[]): string | undefined => {
  for (const file of files) {
    if (file.icon !== 'folder' && file.name === 'SKILL.md') return file.id

    const childFileId = file.children ? getSkillMdFileId(file.children) : undefined
    if (childFileId) return childFileId
  }
}

const getFirstSkillFileId = (files: AgentFileNode[]): string | undefined => {
  for (const file of files) {
    if (file.icon !== 'folder') return file.id

    const childFileId = file.children ? getFirstSkillFileId(file.children) : undefined
    if (childFileId) return childFileId
  }
}

const findSkillFileById = (files: AgentFileNode[], fileId?: string): AgentFileNode | undefined => {
  if (!fileId) return undefined

  for (const file of files) {
    if (file.id === fileId) return file

    const childFile = file.children ? findSkillFileById(file.children, fileId) : undefined
    if (childFile) return childFile
  }
}

export function useAgentSkillDetail({
  apiContext,
  canDownload,
  description,
  isOpen,
  skill,
}: {
  apiContext: AgentConfigApiContext
  canDownload: boolean
  description: string
  isOpen: boolean
  skill: AgentSkill
}): AgentSkillDetail {
  const { t: tCommon } = useTranslation(['common'])
  const queryClient = useQueryClient()
  const [selectedFileId, setSelectedFileId] = useState<string>()
  const [downloadActionLoadingTarget, setDownloadActionLoadingTarget] =
    useState<AgentSkillDetailDownloadAction | null>(null)
  const agentSkillInspectQuery = useQuery({
    ...consoleQuery.agent.byAgentId.config.skills.byName.inspect.get.queryOptions({
      input: {
        params: {
          agent_id: apiContext.agentId,
          name: skill.name,
        },
        query: {
          draft_type: apiContext.draftType,
          version_id: apiContext.versionId,
        },
      },
    }),
    enabled: isOpen && !apiContext.workflow && !apiContext.trialAppId,
  })
  const workflowSkillInspectQuery = useQuery({
    ...consoleQuery.apps.byAppId.agent.config.skills.byName.inspect.get.queryOptions({
      input: {
        params: {
          app_id: apiContext.workflow?.appId ?? '',
          name: skill.name,
        },
        query: {
          node_id: apiContext.workflow?.nodeId,
          draft_type: apiContext.draftType,
          version_id: apiContext.versionId,
        },
      },
    }),
    enabled: isOpen && !!apiContext.workflow,
  })
  const trialSkillInspectQuery = useQuery(
    consoleQuery.trialApps.byAppId.agent.config.skills.byName.inspect.get.queryOptions({
      input: apiContext.trialAppId
        ? {
            params: { app_id: apiContext.trialAppId, name: skill.name },
            query: { version_id: apiContext.versionId },
          }
        : skipToken,
      enabled: !!apiContext.trialAppId && isOpen,
    }),
  )
  const inspectQuery = apiContext.trialAppId
    ? trialSkillInspectQuery
    : apiContext.workflow
      ? workflowSkillInspectQuery
      : agentSkillInspectQuery
  const detailFiles = useMemo(
    () => toSkillFileTree(inspectQuery.data?.files ?? []),
    [inspectQuery.data?.files],
  )
  const previewFileId =
    selectedFileId ??
    inspectQuery.data?.skill_md.path ??
    (inspectQuery.isSuccess
      ? (getSkillMdFileId(detailFiles) ?? getFirstSkillFileId(detailFiles))
      : undefined)
  const selectedFile = findSkillFileById(detailFiles, previewFileId)
  const isSkillMdSelected =
    previewFileId === inspectQuery.data?.skill_md.path || selectedFile?.name === 'SKILL.md'
  const selectedPreviewPath = isSkillMdSelected
    ? undefined
    : (selectedFile?.configName ?? selectedFile?.id)
  const isFileDataPreview = hasFileDataPreview(selectedFile?.icon)
  const shouldLoadTextPreview = isOpen && !!selectedPreviewPath && !isFileDataPreview
  const shouldLoadFileData = isOpen && !!selectedPreviewPath && isFileDataPreview
  const agentPreviewQuery = useQuery({
    ...consoleQuery.agent.byAgentId.config.skills.byName.files.preview.get.queryOptions({
      input: {
        params: {
          agent_id: apiContext.agentId,
          name: skill.name,
        },
        query: {
          path: selectedPreviewPath ?? '',
          draft_type: apiContext.draftType,
          version_id: apiContext.versionId,
        },
      },
    }),
    enabled: shouldLoadTextPreview && !apiContext.workflow && !apiContext.trialAppId,
  })
  const workflowPreviewQuery = useQuery({
    ...consoleQuery.apps.byAppId.agent.config.skills.byName.files.preview.get.queryOptions({
      input: {
        params: {
          app_id: apiContext.workflow?.appId ?? '',
          name: skill.name,
        },
        query: {
          node_id: apiContext.workflow?.nodeId,
          path: selectedPreviewPath ?? '',
          draft_type: apiContext.draftType,
          version_id: apiContext.versionId,
        },
      },
    }),
    enabled: shouldLoadTextPreview && !!apiContext.workflow,
  })
  const trialPreviewQuery = useQuery(
    consoleQuery.trialApps.byAppId.agent.config.skills.byName.files.preview.get.queryOptions({
      input: apiContext.trialAppId
        ? {
            params: { app_id: apiContext.trialAppId, name: skill.name },
            query: { path: selectedPreviewPath ?? '', version_id: apiContext.versionId },
          }
        : skipToken,
      enabled: !!apiContext.trialAppId && shouldLoadTextPreview,
    }),
  )
  const previewQuery = apiContext.trialAppId
    ? trialPreviewQuery
    : apiContext.workflow
      ? workflowPreviewQuery
      : agentPreviewQuery
  const agentDownloadQuery = useQuery({
    ...consoleQuery.agent.byAgentId.config.skills.byName.files.download.get.queryOptions({
      input: {
        params: {
          agent_id: apiContext.agentId,
          name: skill.name,
        },
        query: {
          path: selectedPreviewPath ?? '',
          draft_type: apiContext.draftType,
          version_id: apiContext.versionId,
        },
      },
    }),
    staleTime: 0,
    refetchOnWindowFocus: false,
    enabled: shouldLoadFileData && !apiContext.workflow && !apiContext.trialAppId,
  })
  const workflowDownloadQuery = useQuery({
    ...consoleQuery.apps.byAppId.agent.config.skills.byName.files.download.get.queryOptions({
      input: {
        params: {
          app_id: apiContext.workflow?.appId ?? '',
          name: skill.name,
        },
        query: {
          node_id: apiContext.workflow?.nodeId,
          path: selectedPreviewPath ?? '',
          draft_type: apiContext.draftType,
          version_id: apiContext.versionId,
        },
      },
    }),
    staleTime: 0,
    refetchOnWindowFocus: false,
    enabled: shouldLoadFileData && !!apiContext.workflow,
  })
  const trialDownloadQuery = useQuery(
    consoleQuery.trialApps.byAppId.agent.config.skills.byName.files.download.get.queryOptions({
      input: apiContext.trialAppId
        ? {
            params: { app_id: apiContext.trialAppId, name: skill.name },
            query: { path: selectedPreviewPath ?? '', version_id: apiContext.versionId },
          }
        : skipToken,
      enabled: !!apiContext.trialAppId && shouldLoadFileData,
      staleTime: 0,
      refetchOnWindowFocus: false,
    }),
  )
  const downloadQuery = apiContext.trialAppId
    ? trialDownloadQuery
    : apiContext.workflow
      ? workflowDownloadQuery
      : agentDownloadQuery
  const skillFileContentUrl = downloadQuery.data?.url
  const fileContentQuery = useQuery(
    skillFileContentUrl
      ? {
          ...getSkillFileContentQueryOptions(skillFileContentUrl),
          enabled: shouldLoadFileData,
        }
      : {
          queryKey: skillFileContentQueryKey(),
          queryFn: skipToken,
        },
  )
  const handleDownloadFile = useCallback(
    async (action: AgentSkillDetailDownloadAction) => {
      if (!selectedFile) return

      const file = selectedFile
      const path = file.configName ?? file.id
      const isSkillMdFile = path === inspectQuery.data?.skill_md.path || file.name === 'SKILL.md'

      if (
        isSkillMdFile &&
        !inspectQuery.data?.skill_md.truncated &&
        inspectQuery.data?.skill_md.text !== undefined
      ) {
        downloadBlob({
          data: new Blob([inspectQuery.data.skill_md.text], {
            type: 'text/markdown;charset=utf-8',
          }),
          fileName: file.name,
        })
        return
      }

      if (isFileDataPreview && fileContentQuery.isSuccess && !fileContentQuery.isFetching) {
        downloadBlob({ data: fileContentQuery.data, fileName: file.name })
        return
      }

      setDownloadActionLoadingTarget(action)
      try {
        if (apiContext.trialAppId) {
          const result = await queryClient.query({
            ...consoleQuery.trialApps.byAppId.agent.config.skills.byName.files.download.get.queryOptions(
              {
                context: { silent: true },
                input: {
                  params: { app_id: apiContext.trialAppId, name: skill.name },
                  query: { path, version_id: apiContext.versionId },
                },
              },
            ),
            staleTime: 0,
          })
          const data = await queryClient.query(getSkillFileContentQueryOptions(result.url))
          downloadBlob({ data, fileName: file.name })
          return
        }
        if (apiContext.workflow) {
          const result = await queryClient.query({
            ...consoleQuery.apps.byAppId.agent.config.skills.byName.files.download.get.queryOptions(
              {
                context: { silent: true },
                input: {
                  params: {
                    app_id: apiContext.workflow.appId,
                    name: skill.name,
                  },
                  query: {
                    node_id: apiContext.workflow.nodeId,
                    path,
                    draft_type: apiContext.draftType,
                    version_id: apiContext.versionId,
                  },
                },
              },
            ),
            staleTime: 0,
          })
          const data = await queryClient.query(getSkillFileContentQueryOptions(result.url))
          downloadBlob({ data, fileName: file.name })
          return
        }

        const result = await queryClient.query({
          ...consoleQuery.agent.byAgentId.config.skills.byName.files.download.get.queryOptions({
            context: { silent: true },
            input: {
              params: {
                agent_id: apiContext.agentId,
                name: skill.name,
              },
              query: {
                path,
                draft_type: apiContext.draftType,
                version_id: apiContext.versionId,
              },
            },
          }),
          staleTime: 0,
        })
        const data = await queryClient.query(getSkillFileContentQueryOptions(result.url))
        downloadBlob({ data, fileName: file.name })
      } catch (error) {
        toast.error(getErrorMessage(error) ?? tCommon(($) => $['operation.downloadFailed']))
      } finally {
        setDownloadActionLoadingTarget(null)
      }
    },
    [
      apiContext,
      inspectQuery.data?.skill_md.path,
      inspectQuery.data?.skill_md.text,
      inspectQuery.data?.skill_md.truncated,
      fileContentQuery.data,
      fileContentQuery.isFetching,
      fileContentQuery.isSuccess,
      isFileDataPreview,
      queryClient,
      selectedFile,
      skill.name,
      tCommon,
    ],
  )

  return {
    description,
    fileCount: countSkillPackageFiles(inspectQuery.data?.files),
    files: detailFiles,
    filePreview: {
      binary: isSkillMdSelected ? inspectQuery.data?.skill_md.binary : previewQuery.data?.binary,
      content: isSkillMdSelected
        ? (inspectQuery.data?.skill_md.text ?? undefined)
        : (previewQuery.data?.text ?? undefined),
      downloadActionLoadingTarget,
      fileData: fileContentQuery.isFetching ? undefined : fileContentQuery.data,
      fileName: selectedFile?.name,
      fileType: selectedFile?.icon,
      isDownloadError: shouldLoadFileData && (downloadQuery.isError || fileContentQuery.isError),
      isDownloadLoading:
        shouldLoadFileData && (downloadQuery.isFetching || fileContentQuery.isFetching),
      isError: isSkillMdSelected
        ? inspectQuery.isError
        : shouldLoadTextPreview && previewQuery.isError,
      isLoading: isSkillMdSelected
        ? inspectQuery.isPending
        : shouldLoadTextPreview && previewQuery.isPending,
      truncated: isSkillMdSelected
        ? inspectQuery.data?.skill_md.truncated
        : previewQuery.data?.truncated,
    },
    onDownloadFile: canDownload ? handleDownloadFile : undefined,
    onSelectFile: (file) => setSelectedFileId(file.id),
    selectedFileId: previewFileId,
    sections: [],
  }
}
