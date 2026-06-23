'use client'

import type { ReactNode } from 'react'
import type { AgentOrchestrateAddActionOptions } from '../add-actions-context'
import type { AgentDriveApiContext } from '../drive-context'
import type { AgentFileNode } from '@/features/agent-v2/agent-composer/form-state'
import {
  Dialog,
  DialogTrigger,
} from '@langgenius/dify-ui/dialog'
import {
  FileTreeGuide,
} from '@langgenius/dify-ui/file-tree'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useCallback, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { consoleQuery } from '@/service/client'
import { useRegisterAgentOrchestrateAddAction } from '../add-actions-context'
import { ConfigureSectionAddButton } from '../common/add-button'
import { ConfigureSectionEmpty } from '../common/empty'
import { ConfigureSection } from '../common/section'
import { FILES_DRIVE_PREFIX, useAgentDriveApiContext, useAgentDriveFiles } from '../drive-context'
import { useAgentOrchestrateReadOnly } from '../read-only-context'
import { AgentSkillDetailDialog } from '../skills/detail-dialog'
import { AgentFileTree } from './tree'
import { AgentFileUploadDialog } from './upload-dialog'

const getAgentFilePreviewKey = (file: AgentFileNode) => file.driveKey ?? file.id

const findAgentFileNode = (files: AgentFileNode[], fileId: string): AgentFileNode | undefined => {
  for (const file of files) {
    if (file.id === fileId)
      return file

    const child = file.children ? findAgentFileNode(file.children, fileId) : undefined
    if (child)
      return child
  }
}

function AgentFileItem({
  children,
  depth,
  file,
  files,
  apiContext,
  onRemove,
  selected,
}: {
  children: ReactNode
  depth: number
  file: AgentFileNode
  files: AgentFileNode[]
  apiContext: AgentDriveApiContext
  onRemove: (fileId: string) => void
  selected: boolean
}) {
  const { t } = useTranslation('agentV2')
  const readOnly = useAgentOrchestrateReadOnly()
  const [isPreviewOpen, setIsPreviewOpen] = useState(false)
  const [selectedFileId, setSelectedFileId] = useState<string>()
  const selectedFile = selectedFileId ? findAgentFileNode(files, selectedFileId) : undefined
  const previewFileId = getAgentFilePreviewKey(selectedFile ?? file)
  const agentPreviewQuery = useQuery({
    ...consoleQuery.agent.byAgentId.drive.files.preview.get.queryOptions({
      input: {
        params: {
          agent_id: apiContext.agentId,
        },
        query: {
          key: previewFileId ?? '',
        },
      },
    }),
    enabled: isPreviewOpen && !!previewFileId && !apiContext.workflow,
  })
  const workflowPreviewQuery = useQuery({
    ...consoleQuery.apps.byAppId.agent.drive.files.preview.get.queryOptions({
      input: {
        params: {
          app_id: apiContext.workflow?.appId ?? '',
        },
        query: {
          key: previewFileId ?? '',
          node_id: apiContext.workflow?.nodeId,
        },
      },
    }),
    enabled: isPreviewOpen && !!previewFileId && !!apiContext.workflow,
  })
  const previewQuery = apiContext.workflow ? workflowPreviewQuery : agentPreviewQuery
  const selectedPreviewFile = selectedFile ?? file
  const isImagePreviewFile = selectedPreviewFile.icon === 'image'
  const shouldDownloadPreviewFile = isPreviewOpen && !!previewFileId && (isImagePreviewFile || !!previewQuery.data?.binary)
  const agentDownloadQuery = useQuery({
    ...consoleQuery.agent.byAgentId.drive.files.download.get.queryOptions({
      input: {
        params: {
          agent_id: apiContext.agentId,
        },
        query: {
          key: previewFileId ?? '',
        },
      },
    }),
    enabled: shouldDownloadPreviewFile && !apiContext.workflow,
  })
  const workflowDownloadQuery = useQuery({
    ...consoleQuery.apps.byAppId.agent.drive.files.download.get.queryOptions({
      input: {
        params: {
          app_id: apiContext.workflow?.appId ?? '',
        },
        query: {
          key: previewFileId ?? '',
          node_id: apiContext.workflow?.nodeId,
        },
      },
    }),
    enabled: shouldDownloadPreviewFile && !!apiContext.workflow,
  })
  const downloadQuery = apiContext.workflow ? workflowDownloadQuery : agentDownloadQuery
  const handleRemove = useCallback(() => {
    onRemove(file.id)
  }, [file.id, onRemove])
  const handlePreviewOpenChange = useCallback((open: boolean) => {
    if (open)
      setSelectedFileId(file.id)
    setIsPreviewOpen(open)
  }, [file.id])

  return (
    <li className="group/file-row relative min-w-0">
      <Dialog open={isPreviewOpen} onOpenChange={handlePreviewOpenChange}>
        <DialogTrigger
          render={(
            <button
              type="button"
              data-selected={selected || undefined}
              aria-current={selected ? 'true' : undefined}
              className="group/file-tree-row relative flex h-6 w-full min-w-0 cursor-pointer items-center rounded-md pr-7 pl-2 text-left outline-hidden select-none hover:bg-state-base-hover focus-visible:bg-state-base-hover focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:ring-inset data-[selected]:bg-state-base-active"
            />
          )}
        >
          {Array.from({ length: Math.max(depth - 1, 0) }, (_, index) => (
            <FileTreeGuide key={index} />
          ))}
          <div className="flex min-w-0 flex-[1_0_0] items-center py-0.5">
            {children}
          </div>
        </DialogTrigger>
        <AgentSkillDetailDialog
          skillName={file.name}
          detail={{
            description: t('agentDetail.configure.files.tip'),
            files,
            filePreview: {
              binary: previewQuery.data?.binary,
              content: previewQuery.data?.text ?? undefined,
              downloadUrl: downloadQuery.data?.url,
              fileName: selectedPreviewFile.name,
              isDownloadError: downloadQuery.isError,
              isDownloadLoading: shouldDownloadPreviewFile && downloadQuery.isPending,
              isError: previewQuery.isError,
              isImage: isImagePreviewFile,
              isLoading: previewQuery.isPending,
            },
            onSelectFile: selectedFile => setSelectedFileId(selectedFile.id),
            selectedFileId: selectedFileId ?? file.id,
            sections: [],
          }}
        />
      </Dialog>
      {!readOnly && (
        <button
          type="button"
          data-agent-file-remove-button
          aria-label={t('agentDetail.configure.files.remove', { name: file.name })}
          onClick={handleRemove}
          className="pointer-events-none absolute top-1/2 right-1 z-10 flex size-5 -translate-y-1/2 items-center justify-center rounded-md text-text-tertiary opacity-0 group-focus-within/file-row:pointer-events-auto group-focus-within/file-row:opacity-100 group-hover/file-row:pointer-events-auto group-hover/file-row:opacity-100 hover:bg-state-destructive-hover hover:text-text-destructive focus-visible:bg-state-destructive-hover focus-visible:text-text-destructive focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden"
        >
          <span aria-hidden className="i-ri-delete-bin-line size-4" />
        </button>
      )}
    </li>
  )
}

export function AgentFiles() {
  const { t } = useTranslation('agentV2')
  const filesTip = t('agentDetail.configure.files.tip')
  const filesTreeId = 'agent-configure-files-tree'
  const [isUploadOpen, setIsUploadOpen] = useState(false)
  const promptAddCallbackRef = useRef<AgentOrchestrateAddActionOptions['onAdded']>(undefined)
  const apiContext = useAgentDriveApiContext()
  const { query: driveFilesQuery, files } = useAgentDriveFiles({ prefix: FILES_DRIVE_PREFIX })
  const { mutate: deleteAgentFile } = useMutation(consoleQuery.agent.byAgentId.files.delete.mutationOptions())
  const { mutate: deleteWorkflowAgentFile } = useMutation(consoleQuery.apps.byAppId.agent.files.delete.mutationOptions())
  const removeFile = useCallback((fileId: string) => {
    const file = findAgentFileNode(files, fileId)
    const driveKey = file?.driveKey

    if (!driveKey)
      return

    const onSuccess = () => {
      void driveFilesQuery.refetch()
    }
    if (apiContext.workflow) {
      deleteWorkflowAgentFile({
        params: {
          app_id: apiContext.workflow.appId,
        },
        query: {
          key: driveKey,
          node_id: apiContext.workflow.nodeId,
        },
      }, { onSuccess })
      return
    }

    deleteAgentFile({
      params: {
        agent_id: apiContext.agentId,
      },
      query: {
        key: driveKey,
      },
    }, { onSuccess })
  }, [apiContext, deleteAgentFile, deleteWorkflowAgentFile, driveFilesQuery, files])
  const handleOpenUpload = useCallback((options?: AgentOrchestrateAddActionOptions) => {
    promptAddCallbackRef.current = options?.onAdded
    setIsUploadOpen(true)
  }, [])
  useRegisterAgentOrchestrateAddAction('files', handleOpenUpload)
  const handleUploaded = useCallback((file: AgentFileNode) => {
    void driveFilesQuery.refetch()
    promptAddCallbackRef.current?.(file)
    promptAddCallbackRef.current = undefined
  }, [driveFilesQuery])
  const handleUploadOpenChange = useCallback((open: boolean) => {
    if (!open)
      promptAddCallbackRef.current = undefined
    setIsUploadOpen(open)
  }, [])

  return (
    <>
      <ConfigureSection
        label={t('agentDetail.configure.files.label')}
        labelId="agent-configure-files-label"
        tip={filesTip}
        tipAriaLabel={filesTip}
        rootClassName="border-b border-divider-subtle pt-4"
        panelContentClassName="pb-4"
        actions={(
          <ConfigureSectionAddButton
            ariaLabel={t('agentDetail.configure.files.add')}
            onClick={() => handleOpenUpload()}
          />
        )}
      >
        {files.length === 0
          ? (
              <ConfigureSectionEmpty
                title={t('agentDetail.configure.files.empty.title')}
                description={t('agentDetail.configure.files.empty.description')}
              />
            )
          : (
              <AgentFileTree
                id={filesTreeId}
                files={files}
                treeLabel={t('agentDetail.configure.files.treeLabel')}
                className="rounded-lg border-[0.5px] border-components-panel-border bg-components-panel-on-panel-item-bg p-1 shadow-xs shadow-shadow-shadow-3"
                scrollAreaClassName="max-h-[250px] flex-none"
                renderFile={({ depth, file, selected, children }) => (
                  <AgentFileItem
                    depth={depth}
                    file={file}
                    files={files}
                    apiContext={apiContext}
                    selected={selected}
                    onRemove={removeFile}
                  >
                    {children}
                  </AgentFileItem>
                )}
              />
            )}
      </ConfigureSection>
      <AgentFileUploadDialog
        apiContext={apiContext}
        open={isUploadOpen}
        onOpenChange={handleUploadOpenChange}
        onUploaded={handleUploaded}
      />
    </>
  )
}
