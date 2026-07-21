'use client'

import type { AgentConfigSkillFileResponse } from '@dify/contracts/api/console/agent/types.gen'
import type { AgentConfigApiContext } from '../config-context'
import type { AgentSkillDetail } from './detail-dialog'
import type { AgentFileNode, AgentSkill } from '@/features/agent-v2/agent-composer/form-state'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useMemo, useState } from 'react'
import { consoleQuery } from '@/service/client'
import { downloadBlob, downloadUrl } from '@/utils/download'
import { getDriveFileIconType } from '../files/file-icon'

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
          fileKind: item.type,
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
  description,
  isOpen,
  skill,
}: {
  apiContext: AgentConfigApiContext
  description: string
  isOpen: boolean
  skill: AgentSkill
}): AgentSkillDetail {
  const queryClient = useQueryClient()
  const [selectedFileId, setSelectedFileId] = useState<string>()
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
    enabled: isOpen && !apiContext.workflow,
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
  const inspectQuery = apiContext.workflow ? workflowSkillInspectQuery : agentSkillInspectQuery
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
    enabled: isOpen && !!selectedPreviewPath && !apiContext.workflow,
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
    enabled: isOpen && !!selectedPreviewPath && !!apiContext.workflow,
  })
  const previewQuery = apiContext.workflow ? workflowPreviewQuery : agentPreviewQuery
  const isImagePreviewFile = selectedFile?.icon === 'image'
  const shouldDownloadPreviewFile =
    isOpen && !!selectedPreviewPath && (isImagePreviewFile || !!previewQuery.data?.binary)
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
    enabled: shouldDownloadPreviewFile && !apiContext.workflow,
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
    enabled: shouldDownloadPreviewFile && !!apiContext.workflow,
  })
  const downloadQuery = apiContext.workflow ? workflowDownloadQuery : agentDownloadQuery
  const handleDownloadFile = useCallback(async () => {
    if (!selectedFile) return

    const file = selectedFile
    const path = file.configName ?? file.id
    const isSkillMdFile = path === inspectQuery.data?.skill_md.path || file.name === 'SKILL.md'

    if (isSkillMdFile && inspectQuery.data?.skill_md.text !== undefined) {
      downloadBlob({
        data: new Blob([inspectQuery.data.skill_md.text], { type: 'text/markdown;charset=utf-8' }),
        fileName: file.name,
      })
      return
    }

    if (apiContext.workflow) {
      const result = await queryClient.fetchQuery(
        consoleQuery.apps.byAppId.agent.config.skills.byName.files.download.get.queryOptions({
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
        }),
      )
      downloadUrl({ url: result.url, fileName: file.name })
      return
    }

    const result = await queryClient.fetchQuery(
      consoleQuery.agent.byAgentId.config.skills.byName.files.download.get.queryOptions({
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
    )
    downloadUrl({ url: result.url, fileName: file.name })
  }, [
    apiContext,
    inspectQuery.data?.skill_md.path,
    inspectQuery.data?.skill_md.text,
    queryClient,
    selectedFile,
    skill.name,
  ])

  return {
    description,
    fileCount: countSkillPackageFiles(inspectQuery.data?.files),
    files: detailFiles,
    filePreview: {
      binary: isSkillMdSelected ? inspectQuery.data?.skill_md.binary : previewQuery.data?.binary,
      content: isSkillMdSelected
        ? (inspectQuery.data?.skill_md.text ?? undefined)
        : (previewQuery.data?.text ?? undefined),
      downloadUrl: downloadQuery.data?.url,
      fileName: selectedFile?.name,
      isDownloadError: downloadQuery.isError,
      isDownloadLoading: shouldDownloadPreviewFile && downloadQuery.isPending,
      isError: isSkillMdSelected
        ? inspectQuery.isError
        : !!selectedPreviewPath && previewQuery.isError,
      isImage: isImagePreviewFile,
      isLoading: isSkillMdSelected
        ? inspectQuery.isPending
        : !!selectedPreviewPath && previewQuery.isPending,
    },
    onDownloadFile: handleDownloadFile,
    onSelectFile: (file) => setSelectedFileId(file.id),
    selectedFileId: previewFileId,
    sections: [],
  }
}
