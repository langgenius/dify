'use client'

import type { AgentDriveItemResponse } from '@dify/contracts/api/console/agent/types.gen'
import type { AgentFileNode, AgentSkill } from '@/features/agent-v2/agent-composer/form-state'
import {
  Dialog,
} from '@langgenius/dify-ui/dialog'
import { useQuery } from '@tanstack/react-query'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { consoleQuery } from '@/service/client'
import { getDriveFileIconType } from '../files/file-icon'
import { useAgentOrchestrateReadOnly } from '../read-only-context'
import { AgentSkillDetailDialog } from './detail-dialog'

const getSkillDrivePath = (skill: AgentSkill) => {
  const skillMdKeySlug = skill.skillMdKey?.split('/', 1)[0]
  return skill.path ?? skillMdKeySlug ?? skill.id
}

const getSkillFileName = (key: string, skillDrivePath: string) => key.startsWith(`${skillDrivePath}/`)
  ? key.slice(skillDrivePath.length + 1)
  : key

const toSkillFileNode = (item: AgentDriveItemResponse, skillDrivePath: string) => ({
  icon: getDriveFileIconType({
    fileKind: item.file_kind,
    fileName: getSkillFileName(item.key, skillDrivePath),
    mimeType: item.mime_type,
  }),
  id: item.key,
  name: getSkillFileName(item.key, skillDrivePath),
})

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

export function AgentSkillItem({
  agentId,
  skill,
  onRemove,
}: {
  agentId: string
  skill: AgentSkill
  onRemove: (skillId: string) => void
}) {
  const { t } = useTranslation('agentV2')
  const readOnly = useAgentOrchestrateReadOnly()
  const [isPreviewOpen, setIsPreviewOpen] = useState(false)
  const [selectedFileId, setSelectedFileId] = useState<string>()
  const handleRemove = useCallback(() => {
    onRemove(skill.id)
  }, [onRemove, skill.id])
  const handleOpenPreview = useCallback(() => {
    setSelectedFileId(undefined)
    setIsPreviewOpen(true)
  }, [])
  const skillDrivePath = getSkillDrivePath(skill)
  const driveFilesQuery = useQuery({
    ...consoleQuery.agent.byAgentId.drive.files.get.queryOptions({
      input: {
        params: {
          agent_id: agentId,
        },
        query: {
          prefix: `${skillDrivePath}/`,
        },
      },
    }),
    enabled: isPreviewOpen,
  })
  const detailFiles = driveFilesQuery.isSuccess
    ? (driveFilesQuery.data.items ?? []).map(item => toSkillFileNode(item, skillDrivePath))
    : []
  const previewFileId = selectedFileId
    ?? skill.skillMdKey
    ?? (driveFilesQuery.isSuccess ? getSkillMdFileId(detailFiles) ?? getFirstSkillFileId(detailFiles) : undefined)
  const previewQuery = useQuery({
    ...consoleQuery.agent.byAgentId.drive.files.preview.get.queryOptions({
      input: {
        params: {
          agent_id: agentId,
        },
        query: {
          key: previewFileId ?? '',
        },
      },
    }),
    enabled: isPreviewOpen && !!previewFileId,
  })
  const selectedFile = detailFiles.find(file => file.id === previewFileId)
  const isImagePreviewFile = selectedFile?.icon === 'image'
  const downloadQuery = useQuery({
    ...consoleQuery.agent.byAgentId.drive.files.download.get.queryOptions({
      input: {
        params: {
          agent_id: agentId,
        },
        query: {
          key: previewFileId ?? '',
        },
      },
    }),
    enabled: isPreviewOpen && !!previewFileId && (isImagePreviewFile || !!previewQuery.data?.binary),
  })

  return (
    <Dialog open={isPreviewOpen} onOpenChange={setIsPreviewOpen}>
      <div className="group flex h-8 items-center gap-1 overflow-hidden rounded-lg border-[0.5px] border-components-panel-border bg-components-panel-on-panel-item-bg py-1 pr-2.5 pl-2 shadow-xs shadow-shadow-shadow-3 focus-within:bg-components-panel-on-panel-item-bg-hover focus-within:shadow-sm hover:bg-components-panel-on-panel-item-bg-hover hover:pr-1 hover:shadow-sm has-[[data-agent-skill-remove-button]:focus-visible]:border-state-destructive-border! has-[[data-agent-skill-remove-button]:focus-visible]:bg-state-destructive-hover! has-[[data-agent-skill-remove-button]:focus-visible]:shadow-xs! has-[[data-agent-skill-remove-button]:hover]:border-state-destructive-border! has-[[data-agent-skill-remove-button]:hover]:bg-state-destructive-hover! has-[[data-agent-skill-remove-button]:hover]:shadow-xs!">
        <button
          type="button"
          className="flex h-full min-w-0 flex-1 cursor-pointer items-center gap-1 rounded-md text-left outline-hidden focus-visible:ring-2 focus-visible:ring-state-accent-solid"
          onClick={handleOpenPreview}
        >
          <span aria-hidden className="i-custom-public-agent-building-blocks size-4 shrink-0" />
          <span className="min-w-0 flex-1 truncate system-sm-medium text-text-secondary">
            {skill.name}
          </span>
        </button>
        {!readOnly && (
          <div className="hidden shrink-0 items-center justify-center rounded-md p-0.5 group-focus-within:flex group-hover:flex">
            <button
              type="button"
              data-agent-skill-remove-button
              aria-label={t('agentDetail.configure.skills.remove', { name: skill.name })}
              onClick={handleRemove}
              className="flex size-5 items-center justify-center rounded-md text-text-tertiary hover:bg-state-destructive-hover hover:text-text-destructive focus-visible:bg-state-destructive-hover focus-visible:text-text-destructive focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden"
            >
              <span aria-hidden className="i-ri-delete-bin-line size-4" />
            </button>
          </div>
        )}
        <div className="flex shrink-0 items-center justify-center group-focus-within:hidden group-hover:hidden">
          <span className="system-xs-regular text-text-tertiary">
            {t('agentDetail.configure.skills.itemType')}
          </span>
        </div>
      </div>
      {isPreviewOpen && (
        <AgentSkillDetailDialog
          skillName={skill.name}
          detail={{
            description: skill.description ?? t('agentDetail.configure.skills.tip'),
            files: detailFiles,
            filePreview: {
              binary: previewQuery.data?.binary,
              content: previewQuery.data?.text ?? undefined,
              downloadUrl: downloadQuery.data?.url,
              fileName: selectedFile?.name,
              isDownloadError: downloadQuery.isError,
              isDownloadLoading: (isImagePreviewFile || !!previewQuery.data?.binary) && downloadQuery.isPending,
              isError: previewQuery.isError,
              isImage: isImagePreviewFile,
              isLoading: previewQuery.isPending,
            },
            onSelectFile: file => setSelectedFileId(file.id),
            selectedFileId: previewFileId,
            sections: [],
          }}
        />
      )}
    </Dialog>
  )
}
