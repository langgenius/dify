'use client'

import type { AgentDriveSkillFileResponse } from '@dify/contracts/api/console/agent/types.gen'
import type { AgentDriveApiContext } from '../drive-context'
import type { AgentSkillDetail } from './detail-dialog'
import type { AgentFileNode, AgentSkill } from '@/features/agent-v2/agent-composer/form-state'
import { useQuery } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { consoleQuery } from '@/service/client'
import { getDriveFileIconType } from '../files/file-icon'

const DIFY_SKILL_FULL_ARCHIVE_NAME = '.DIFY-SKILL-FULL.zip'

const getSkillDrivePath = (skill: AgentSkill) => {
  const skillMdKeySlug = skill.skillMdKey?.split('/', 1)[0]
  return skill.path ?? skillMdKeySlug ?? skill.id
}

const getSkillFileName = (key: string, skillDrivePath: string) => key.startsWith(`${skillDrivePath}/`)
  ? key.slice(skillDrivePath.length + 1)
  : key

const getSkillRelativePath = (path: string, skillDrivePath: string) =>
  getSkillFileName(path, skillDrivePath).split('/').filter(Boolean).join('/')

const isSkillArchiveFile = (path: string) =>
  path === DIFY_SKILL_FULL_ARCHIVE_NAME || path.endsWith(`/${DIFY_SKILL_FULL_ARCHIVE_NAME}`)

const isSkillFolder = (file: AgentDriveSkillFileResponse) =>
  file.type === 'directory' || file.type === 'folder'

const toSkillFileNode = (item: AgentDriveSkillFileResponse, skillDrivePath: string): AgentFileNode => {
  const filePath = getSkillFileName(item.path, skillDrivePath)
  const fileName = item.name || filePath.split('/').pop() || filePath
  const id = item.drive_key
    ?? (item.path.startsWith(`${skillDrivePath}/`) ? item.path : `${skillDrivePath}/${item.path}`)

  return {
    driveKey: item.available_in_drive ? item.drive_key ?? undefined : undefined,
    icon: isSkillFolder(item)
      ? 'folder'
      : getDriveFileIconType({
          fileKind: item.type,
          fileName,
          mimeType: undefined,
        }),
    id,
    name: fileName,
  }
}

const sortSkillFileNodes = (files: AgentFileNode[]): AgentFileNode[] => [...files].sort((first, second) => {
  const firstIsFolder = first.icon === 'folder'
  const secondIsFolder = second.icon === 'folder'

  if (firstIsFolder !== secondIsFolder)
    return firstIsFolder ? -1 : 1

  return first.name.localeCompare(second.name)
}).map(file => file.children ? { ...file, children: sortSkillFileNodes(file.children) } : file)

const toSkillFileTree = (files: AgentDriveSkillFileResponse[], skillDrivePath: string): AgentFileNode[] => {
  const root: AgentFileNode[] = []
  const folders = new Map<string, AgentFileNode>()
  const seenFilePaths = new Set<string>()

  for (const file of files) {
    const relativePath = getSkillRelativePath(file.path, skillDrivePath)
    if (!relativePath || isSkillArchiveFile(relativePath))
      continue
    if (!isSkillFolder(file)) {
      if (seenFilePaths.has(relativePath))
        continue

      seenFilePaths.add(relativePath)
    }

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
        ...toSkillFileNode(file, skillDrivePath),
        name: segment,
      })
    })
  }

  return sortSkillFileNodes(root)
}

const countSkillPackageFiles = (files: AgentDriveSkillFileResponse[] | undefined, skillDrivePath: string) => {
  const filePaths = new Set<string>()

  for (const file of files ?? []) {
    if (isSkillFolder(file))
      continue

    const relativePath = getSkillRelativePath(file.path, skillDrivePath)
    if (!relativePath || isSkillArchiveFile(relativePath))
      continue

    filePaths.add(relativePath)
  }

  return filePaths.size
}

const getSkillMdFileId = (files: AgentFileNode[]): string | undefined => {
  for (const file of files) {
    if (file.icon !== 'folder' && file.name === 'SKILL.md')
      return file.id

    const childFileId = file.children ? getSkillMdFileId(file.children) : undefined
    if (childFileId)
      return childFileId
  }
}

const getFirstSkillFileId = (files: AgentFileNode[]): string | undefined => {
  for (const file of files) {
    if (file.icon !== 'folder')
      return file.id

    const childFileId = file.children ? getFirstSkillFileId(file.children) : undefined
    if (childFileId)
      return childFileId
  }
}

const findSkillFileById = (files: AgentFileNode[], fileId?: string): AgentFileNode | undefined => {
  if (!fileId)
    return undefined

  for (const file of files) {
    if (file.id === fileId)
      return file

    const childFile = file.children ? findSkillFileById(file.children, fileId) : undefined
    if (childFile)
      return childFile
  }
}

export function useAgentSkillDetail({
  apiContext,
  description,
  isOpen,
  skill,
}: {
  apiContext: AgentDriveApiContext
  description: string
  isOpen: boolean
  skill: AgentSkill
}): AgentSkillDetail {
  const [selectedFileId, setSelectedFileId] = useState<string>()
  const skillDrivePath = getSkillDrivePath(skill)
  const agentSkillInspectQuery = useQuery({
    ...consoleQuery.agent.byAgentId.drive.skills.bySkillPath.inspect.get.queryOptions({
      input: {
        params: {
          agent_id: apiContext.agentId,
          skill_path: skillDrivePath,
        },
      },
    }),
    enabled: isOpen && !apiContext.workflow,
  })
  const workflowSkillInspectQuery = useQuery({
    ...consoleQuery.apps.byAppId.agent.drive.skills.bySkillPath.inspect.get.queryOptions({
      input: {
        params: {
          app_id: apiContext.workflow?.appId ?? '',
          skill_path: skillDrivePath,
        },
        query: {
          node_id: apiContext.workflow?.nodeId,
        },
      },
    }),
    enabled: isOpen && !!apiContext.workflow,
  })
  const inspectQuery = apiContext.workflow ? workflowSkillInspectQuery : agentSkillInspectQuery
  const detailFiles = useMemo(
    () => toSkillFileTree(inspectQuery.data?.files ?? [], skillDrivePath),
    [inspectQuery.data?.files, skillDrivePath],
  )
  const previewFileId = selectedFileId
    ?? skill.skillMdKey
    ?? inspectQuery.data?.skill_md.key
    ?? (inspectQuery.isSuccess ? getSkillMdFileId(detailFiles) ?? getFirstSkillFileId(detailFiles) : undefined)
  const selectedFile = findSkillFileById(detailFiles, previewFileId)
  const isSkillMdSelected = previewFileId === inspectQuery.data?.skill_md.key
    || previewFileId === skill.skillMdKey
    || selectedFile?.name === 'SKILL.md'
  const selectedPreviewKey = isSkillMdSelected
    ? undefined
    : selectedFile?.driveKey
  const agentPreviewQuery = useQuery({
    ...consoleQuery.agent.byAgentId.drive.files.preview.get.queryOptions({
      input: {
        params: {
          agent_id: apiContext.agentId,
        },
        query: {
          key: selectedPreviewKey ?? '',
        },
      },
    }),
    enabled: isOpen && !!selectedPreviewKey && !apiContext.workflow,
  })
  const workflowPreviewQuery = useQuery({
    ...consoleQuery.apps.byAppId.agent.drive.files.preview.get.queryOptions({
      input: {
        params: {
          app_id: apiContext.workflow?.appId ?? '',
        },
        query: {
          node_id: apiContext.workflow?.nodeId,
          key: selectedPreviewKey ?? '',
        },
      },
    }),
    enabled: isOpen && !!selectedPreviewKey && !!apiContext.workflow,
  })
  const previewQuery = apiContext.workflow ? workflowPreviewQuery : agentPreviewQuery
  const isImagePreviewFile = selectedFile?.icon === 'image'
  const agentDownloadQuery = useQuery({
    ...consoleQuery.agent.byAgentId.drive.files.download.get.queryOptions({
      input: {
        params: {
          agent_id: apiContext.agentId,
        },
        query: {
          key: selectedPreviewKey ?? '',
        },
      },
    }),
    enabled:
      isOpen
      && !!selectedPreviewKey
      && (isImagePreviewFile || !!previewQuery.data?.binary)
      && !apiContext.workflow,
  })
  const workflowDownloadQuery = useQuery({
    ...consoleQuery.apps.byAppId.agent.drive.files.download.get.queryOptions({
      input: {
        params: {
          app_id: apiContext.workflow?.appId ?? '',
        },
        query: {
          node_id: apiContext.workflow?.nodeId,
          key: selectedPreviewKey ?? '',
        },
      },
    }),
    enabled:
      isOpen
      && !!selectedPreviewKey
      && (isImagePreviewFile || !!previewQuery.data?.binary)
      && !!apiContext.workflow,
  })
  const downloadQuery = apiContext.workflow ? workflowDownloadQuery : agentDownloadQuery

  return {
    description,
    fileCount: countSkillPackageFiles(inspectQuery.data?.files, skillDrivePath),
    files: detailFiles,
    filePreview: {
      binary: isSkillMdSelected ? inspectQuery.data?.skill_md.binary : previewQuery.data?.binary,
      content: isSkillMdSelected ? inspectQuery.data?.skill_md.text ?? undefined : previewQuery.data?.text ?? undefined,
      downloadUrl: downloadQuery.data?.url,
      fileName: selectedFile?.name,
      isDownloadError: downloadQuery.isError,
      isDownloadLoading: !!selectedPreviewKey && (isImagePreviewFile || !!previewQuery.data?.binary) && downloadQuery.isPending,
      isError: isSkillMdSelected ? inspectQuery.isError : !!selectedPreviewKey && previewQuery.isError,
      isImage: isImagePreviewFile,
      isLoading: isSkillMdSelected ? inspectQuery.isPending : !!selectedPreviewKey && previewQuery.isPending,
    },
    onSelectFile: file => setSelectedFileId(file.id),
    selectedFileId: previewFileId,
    sections: [],
  }
}
