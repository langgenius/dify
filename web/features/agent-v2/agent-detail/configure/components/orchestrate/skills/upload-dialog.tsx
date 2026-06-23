'use client'

import type { PostAgentByAgentIdSkillsUploadResponse } from '@dify/contracts/api/console/agent/types.gen'
import type { PostAppsByAppIdAgentSkillsUploadResponse } from '@dify/contracts/api/console/apps/types.gen'
import type { AgentDriveApiContext } from '../drive-context'
import type { AgentSkill } from '@/features/agent-v2/agent-composer/form-state'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { Dialog, DialogCloseButton, DialogContent, DialogDescription, DialogTitle } from '@langgenius/dify-ui/dialog'
import { toast } from '@langgenius/dify-ui/toast'
import { useMutation } from '@tanstack/react-query'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import ActionButton from '@/app/components/base/action-button'
import { consoleQuery } from '@/service/client'
import { formatFileSize } from '@/utils/format'

const skillPackageAccept = '.zip,.skill'
const skillPackageExtensions = ['.zip', '.skill']

const getSkillNameFromFile = (file: File) => file.name.replace(/\.(?:skill|zip)$/iu, '') || file.name

const toUploadedSkill = (
  response: PostAgentByAgentIdSkillsUploadResponse | PostAppsByAppIdAgentSkillsUploadResponse,
  file: File,
): AgentSkill => {
  const name = response.skill?.name
    ?? response.manifest?.name
    ?? getSkillNameFromFile(file)
  const id = response.skill?.skill_md_key
    ?? response.skill?.path
    ?? name

  return {
    description: response.skill?.description ?? response.manifest?.description ?? undefined,
    archiveKey: response.skill?.archive_key ?? undefined,
    id,
    name,
    path: response.skill?.path ?? undefined,
    skillMdKey: response.skill?.skill_md_key ?? undefined,
  }
}

function isSupportedSkillPackage(file: File) {
  const fileName = file.name.toLowerCase()

  return skillPackageExtensions.some(extension => fileName.endsWith(extension))
}

function AgentSkillPackageUploader({
  file,
  onChange,
}: {
  file?: File
  onChange: (file?: File) => void
}) {
  const { t } = useTranslation('agentV2')
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)

  const setUploadFiles = (files: File[]) => {
    const [uploadFile] = files
    if (files.length !== 1 || !uploadFile || !isSupportedSkillPackage(uploadFile)) {
      toast.error(t('agentDetail.configure.skills.upload.invalidFile'))
      return
    }

    onChange(uploadFile)
  }

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? [])
    event.target.value = ''
    setUploadFiles(files)
  }

  const handleDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    event.stopPropagation()
    setDragging(false)

    setUploadFiles(Array.from(event.dataTransfer.files))
  }

  return (
    <div className="mt-6">
      <input
        ref={fileInputRef}
        className="hidden"
        type="file"
        accept={skillPackageAccept}
        onChange={handleFileChange}
      />
      {!file && (
        <div
          className={cn(
            'relative flex h-16 items-center rounded-[10px] border border-dashed border-components-dropzone-border bg-components-dropzone-bg text-sm font-normal',
            dragging && 'border-components-dropzone-border-accent bg-components-dropzone-bg-accent',
          )}
          onDragEnter={(event) => {
            event.preventDefault()
            setDragging(true)
          }}
          onDragOver={event => event.preventDefault()}
          onDragLeave={() => setDragging(false)}
          onDrop={handleDrop}
        >
          <div className="flex w-full items-center justify-center space-x-2">
            <span aria-hidden className="i-ri-upload-cloud-2-line size-6 text-text-tertiary" />
            <div className="text-text-tertiary">
              {t('agentDetail.configure.skills.upload.dropzone')}
              <button
                type="button"
                className="inline cursor-pointer border-none bg-transparent p-0 pl-1 text-left text-text-accent focus-visible:ring-1 focus-visible:ring-components-input-border-active focus-visible:outline-hidden"
                onClick={() => fileInputRef.current?.click()}
              >
                {t('agentDetail.configure.skills.upload.browse')}
              </button>
            </div>
          </div>
          {dragging && <div className="absolute top-0 left-0 size-full" />}
        </div>
      )}
      {file && (
        <div className="group flex items-center rounded-lg border-[0.5px] border-components-panel-border bg-components-panel-on-panel-item-bg shadow-xs hover:bg-components-panel-on-panel-item-bg-hover">
          <div className="flex items-center justify-center p-3">
            <span aria-hidden className="i-custom-public-files-yaml size-6 shrink-0" />
          </div>
          <div className="flex grow flex-col items-start gap-0.5 py-1 pr-2">
            <span className="max-w-[calc(100%-30px)] overflow-hidden text-[12px] leading-4 font-medium text-ellipsis whitespace-nowrap text-text-secondary">{file.name}</span>
            <div className="flex h-3 items-center gap-1 self-stretch text-[10px] leading-3 font-medium text-text-tertiary uppercase">
              <span>{t('agentDetail.configure.skills.upload.fileType')}</span>
              <span className="text-text-quaternary">·</span>
              <span>{formatFileSize(file.size)}</span>
            </div>
          </div>
          <div className="hidden items-center pr-3 group-hover:flex">
            <ActionButton onClick={() => onChange(undefined)}>
              <span aria-hidden className="i-ri-delete-bin-line size-4 text-text-tertiary" />
            </ActionButton>
          </div>
        </div>
      )}
    </div>
  )
}

export function AgentSkillUploadDialog({
  apiContext,
  onUploaded,
  open,
  onOpenChange,
}: {
  apiContext: AgentDriveApiContext
  onUploaded?: (skill: AgentSkill) => void
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { t } = useTranslation('agentV2')
  const { t: tCommon } = useTranslation('common')
  const [file, setFile] = useState<File>()
  const uploadAgentSkillMutation = useMutation(consoleQuery.agent.byAgentId.skills.upload.post.mutationOptions())
  const uploadWorkflowSkillMutation = useMutation(consoleQuery.apps.byAppId.agent.skills.upload.post.mutationOptions())
  const uploadSkillMutation = apiContext.workflow ? uploadWorkflowSkillMutation : uploadAgentSkillMutation

  const handleUpload = () => {
    if (!file || uploadSkillMutation.isPending)
      return

    const options = {
      onSuccess: (response: PostAgentByAgentIdSkillsUploadResponse | PostAppsByAppIdAgentSkillsUploadResponse) => {
        toast.success(t('agentDetail.configure.skills.upload.success'))
        onUploaded?.(toUploadedSkill(response, file))
        setFile(undefined)
        onOpenChange(false)
      },
      onError: () => {
        toast.error(t('agentDetail.configure.skills.upload.failed'))
      },
    }

    if (apiContext.workflow) {
      uploadWorkflowSkillMutation.mutate({
        params: {
          app_id: apiContext.workflow.appId,
        },
        query: {
          node_id: apiContext.workflow.nodeId,
        },
        body: {
          file,
        },
      }, options)
      return
    }

    uploadAgentSkillMutation.mutate({
      params: {
        agent_id: apiContext.agentId,
      },
      body: {
        file,
      },
    }, options)
  }

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      uploadAgentSkillMutation.reset()
      uploadWorkflowSkillMutation.reset()
      setFile(undefined)
    }
    onOpenChange(nextOpen)
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange} disablePointerDismissal>
      <DialogContent backdropProps={{ forceRender: true }} backdropClassName="fixed">
        <DialogCloseButton />
        <DialogTitle className="title-2xl-semi-bold text-text-primary">
          {t('agentDetail.configure.skills.upload.title')}
        </DialogTitle>
        <DialogDescription className="mt-1 system-sm-regular text-text-tertiary">
          {t('agentDetail.configure.skills.upload.description')}
        </DialogDescription>
        <AgentSkillPackageUploader
          file={file}
          onChange={setFile}
        />
        <div className="flex justify-end gap-2 pt-6">
          <Button type="button" onClick={() => handleOpenChange(false)} disabled={uploadSkillMutation.isPending}>
            {tCommon('operation.cancel')}
          </Button>
          <Button
            type="button"
            variant="primary"
            disabled={!file}
            loading={uploadSkillMutation.isPending}
            onClick={handleUpload}
          >
            {t('agentDetail.configure.skills.upload.action')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
