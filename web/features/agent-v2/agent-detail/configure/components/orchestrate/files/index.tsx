'use client'

import type { AgentOrchestrateAddActionOptions } from '../add-actions-context'
import type { AgentConfigApiContext } from '../config-context'
import type { AgentFileNode } from '@/features/agent-v2/agent-composer/form-state'
import { cn } from '@langgenius/dify-ui/cn'
import {
  Dialog,
  DialogTrigger,
} from '@langgenius/dify-ui/dialog'
import {
  FileTreeBadge,
  FileTreeGuide,
  FileTreeIcon,
  FileTreeLabel,
} from '@langgenius/dify-ui/file-tree'
import { Tooltip, TooltipContent, TooltipTrigger } from '@langgenius/dify-ui/tooltip'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useAtomValue, useSetAtom } from 'jotai'
import { useCallback, useRef, useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { useDocLink } from '@/context/i18n'
import { agentComposerOriginalConfigAtom } from '@/features/agent-v2/agent-composer/store'
import { agentComposerFilesAtom } from '@/features/agent-v2/agent-composer/store-modules/files'
import { consoleQuery } from '@/service/client'
import { useRegisterAgentOrchestrateAddAction } from '../add-actions-context'
import { ConfigureSectionAddButton } from '../common/add-button'
import { DocsLink } from '../common/docs-link'
import { ConfigureSectionEmpty } from '../common/empty'
import { ConfigureSection } from '../common/section'
import { AgentConfigureTipContent } from '../common/tip-content'
import { useAgentConfigApiContext } from '../config-context'
import { useAgentOrchestrateReadOnly } from '../read-only-context'
import { AgentSkillDetailDialog } from '../skills/detail-dialog'
import { AgentFileTree } from './tree'
import { AgentFileUploadDialog } from './upload-dialog'

const BUILD_NOTE_FILE_ID = '__agent_config_build_note__'
const BUILD_NOTE_FILE_NAME = 'build_note.md'

const getAgentFilePreviewKey = (file: AgentFileNode) => file.configName ?? file.name

const getBuildNoteFile = (configNote: string | undefined): AgentFileNode | undefined => {
  if (!configNote?.trim())
    return undefined

  return {
    id: BUILD_NOTE_FILE_ID,
    icon: 'markdown',
    name: BUILD_NOTE_FILE_NAME,
    virtualContent: configNote,
  }
}

const findAgentFileNode = (files: AgentFileNode[], fileId: string): AgentFileNode | undefined => {
  for (const file of files) {
    if (file.id === fileId)
      return file

    const child = file.children ? findAgentFileNode(file.children, fileId) : undefined
    if (child)
      return child
  }
}

const removeAgentFileNode = (files: AgentFileNode[], fileId: string): AgentFileNode[] => files.flatMap((file) => {
  if (file.id === fileId)
    return []

  if (file.children)
    return [{ ...file, children: removeAgentFileNode(file.children, fileId) }]

  return [file]
})

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
  apiContext: AgentConfigApiContext
  onRemove: (fileId: string) => void
  selected: boolean
}) {
  const { t } = useTranslation('agentV2')
  const readOnly = useAgentOrchestrateReadOnly()
  const [isPreviewOpen, setIsPreviewOpen] = useState(false)
  const [selectedFileId, setSelectedFileId] = useState<string>()
  const selectedFile = selectedFileId ? findAgentFileNode(files, selectedFileId) : undefined
  const selectedPreviewFile = selectedFile ?? file
  const isVirtualPreviewFile = selectedPreviewFile.virtualContent !== undefined
  const isBuildNoteFile = file.id === BUILD_NOTE_FILE_ID
  const previewFileId = isVirtualPreviewFile ? undefined : getAgentFilePreviewKey(selectedPreviewFile)
  const agentPreviewQuery = useQuery({
    ...consoleQuery.agent.byAgentId.config.files.byName.preview.get.queryOptions({
      input: {
        params: {
          agent_id: apiContext.agentId,
          name: previewFileId ?? '',
        },
        query: {
          draft_type: apiContext.draftType,
          version_id: apiContext.versionId,
        },
      },
    }),
    enabled: isPreviewOpen && !!previewFileId && !isVirtualPreviewFile && !apiContext.workflow,
  })
  const workflowPreviewQuery = useQuery({
    ...consoleQuery.apps.byAppId.agent.config.files.byName.preview.get.queryOptions({
      input: {
        params: {
          app_id: apiContext.workflow?.appId ?? '',
          name: previewFileId ?? '',
        },
        query: {
          node_id: apiContext.workflow?.nodeId,
          draft_type: apiContext.draftType,
          version_id: apiContext.versionId,
        },
      },
    }),
    enabled: isPreviewOpen && !!previewFileId && !isVirtualPreviewFile && !!apiContext.workflow,
  })
  const previewQuery = apiContext.workflow ? workflowPreviewQuery : agentPreviewQuery
  const isImagePreviewFile = selectedPreviewFile.icon === 'image'
  const shouldDownloadPreviewFile = isPreviewOpen && !!previewFileId && !isVirtualPreviewFile && (isImagePreviewFile || !!previewQuery.data?.binary)
  const agentDownloadQuery = useQuery({
    ...consoleQuery.agent.byAgentId.config.files.byName.download.get.queryOptions({
      input: {
        params: {
          agent_id: apiContext.agentId,
          name: previewFileId ?? '',
        },
        query: {
          draft_type: apiContext.draftType,
          version_id: apiContext.versionId,
        },
      },
    }),
    enabled: shouldDownloadPreviewFile && !apiContext.workflow,
  })
  const workflowDownloadQuery = useQuery({
    ...consoleQuery.apps.byAppId.agent.config.files.byName.download.get.queryOptions({
      input: {
        params: {
          app_id: apiContext.workflow?.appId ?? '',
          name: previewFileId ?? '',
        },
        query: {
          node_id: apiContext.workflow?.nodeId,
          draft_type: apiContext.draftType,
          version_id: apiContext.versionId,
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
              className={cn(
                'group/file-tree-row relative flex h-6 w-full min-w-0 cursor-pointer items-center rounded-md pl-2 text-left outline-hidden select-none hover:bg-state-base-hover focus-visible:bg-state-base-hover focus-visible:inset-ring-2 focus-visible:inset-ring-state-accent-solid data-[selected]:bg-state-base-active',
                isBuildNoteFile ? 'pr-1' : 'pr-7',
              )}
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
              content: selectedPreviewFile.virtualContent ?? previewQuery.data?.text ?? undefined,
              downloadUrl: downloadQuery.data?.url,
              fileName: selectedPreviewFile.name,
              isDownloadError: downloadQuery.isError,
              isDownloadLoading: shouldDownloadPreviewFile && downloadQuery.isPending,
              isError: !isVirtualPreviewFile && previewQuery.isError,
              isImage: isImagePreviewFile,
              isLoading: !isVirtualPreviewFile && previewQuery.isPending,
            },
            onSelectFile: selectedFile => setSelectedFileId(selectedFile.id),
            selectedFileId: selectedFileId ?? file.id,
            sections: [],
          }}
        />
      </Dialog>
      {!readOnly && !file.virtualContent && (
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

function AgentBuildNoteFileRow() {
  const { t } = useTranslation('agentV2')
  const docLink = useDocLink()
  const tooltip = t('agentDetail.configure.files.buildNote.tooltip')

  return (
    <>
      <FileTreeIcon type="markdown" />
      <FileTreeLabel className="shrink-0" title={BUILD_NOTE_FILE_NAME}>
        {BUILD_NOTE_FILE_NAME}
      </FileTreeLabel>
      <FileTreeBadge className="ml-0.5 gap-0.5 px-1 py-0.5">
        <span aria-hidden className="i-ri-sparkling-line size-3 shrink-0" />
        <span>{t('agentDetail.configure.files.buildNote.generated')}</span>
      </FileTreeBadge>
      <Tooltip>
        <TooltipTrigger
          render={(
            <span
              aria-label={tooltip}
              className="ml-auto flex size-5 shrink-0 items-center justify-center p-0.5 text-text-quaternary"
            >
              <span aria-hidden className="i-ri-question-line size-4" />
            </span>
          )}
        />
        <TooltipContent className="w-[230px] rounded-xl border-[0.5px] border-components-panel-border bg-components-tooltip-bg px-4 py-3.5 shadow-lg backdrop-blur-[5px]">
          <p className="body-xs-regular text-text-secondary">
            <Trans
              i18nKey="agentDetail.configure.files.buildNote.richTooltip"
              ns="agentV2"
              components={{
                docLink: <DocsLink href={docLink('/use-dify/build/new-agent/build#the-build-note')} />,
              }}
            />
          </p>
        </TooltipContent>
      </Tooltip>
    </>
  )
}

export function AgentFiles() {
  const { t } = useTranslation('agentV2')
  const filesTip = t('agentDetail.configure.files.tip')
  const filesTreeId = 'agent-configure-files-tree'
  const [isUploadOpen, setIsUploadOpen] = useState(false)
  const promptAddCallbackRef = useRef<AgentOrchestrateAddActionOptions['onAdded']>(undefined)
  const apiContext = useAgentConfigApiContext()
  const originalConfig = useAtomValue(agentComposerOriginalConfigAtom)
  const files = useAtomValue(agentComposerFilesAtom)
  const setFiles = useSetAtom(agentComposerFilesAtom)
  const buildNoteFile = getBuildNoteFile(originalConfig?.config_note)
  const visibleFiles = buildNoteFile ? [buildNoteFile, ...files] : files
  const { mutate: deleteAgentFile } = useMutation(consoleQuery.agent.byAgentId.config.files.byName.delete.mutationOptions())
  const { mutate: deleteWorkflowAgentFile } = useMutation(consoleQuery.apps.byAppId.agent.config.files.byName.delete.mutationOptions())
  const removeFile = useCallback((fileId: string) => {
    const file = findAgentFileNode(files, fileId)
    const configName = file?.configName ?? file?.name

    if (!configName)
      return

    const onSuccess = () => {
      setFiles(files => removeAgentFileNode(files, fileId))
    }
    if (apiContext.workflow) {
      deleteWorkflowAgentFile({
        params: {
          app_id: apiContext.workflow.appId,
          name: configName,
        },
        query: {
          node_id: apiContext.workflow.nodeId,
          draft_type: apiContext.draftType,
          version_id: apiContext.versionId,
        },
      }, { onSuccess })
      return
    }

    deleteAgentFile({
      params: {
        agent_id: apiContext.agentId,
        name: configName,
      },
      query: {
        draft_type: apiContext.draftType,
        version_id: apiContext.versionId,
      },
    }, { onSuccess })
  }, [apiContext, deleteAgentFile, deleteWorkflowAgentFile, files, setFiles])
  const handleOpenUpload = useCallback((options?: AgentOrchestrateAddActionOptions) => {
    promptAddCallbackRef.current = options?.onAdded
    setIsUploadOpen(true)
  }, [])
  useRegisterAgentOrchestrateAddAction('files', handleOpenUpload)
  const handleUploaded = useCallback((file: AgentFileNode) => {
    setFiles(files => [
      ...removeAgentFileNode(files, file.id),
      file,
    ])
    promptAddCallbackRef.current?.(file)
    promptAddCallbackRef.current = undefined
  }, [setFiles])
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
        buildDraftChangeSection="files"
        tip={<AgentConfigureTipContent type="files" />}
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
        {visibleFiles.length === 0
          ? (
              <ConfigureSectionEmpty
                title={t('agentDetail.configure.files.empty.title')}
                description={t('agentDetail.configure.files.empty.description')}
              />
            )
          : (
              <AgentFileTree
                id={filesTreeId}
                files={visibleFiles}
                treeLabel={t('agentDetail.configure.files.treeLabel')}
                className="rounded-lg border-[0.5px] border-components-panel-border bg-components-panel-on-panel-item-bg p-1 shadow-xs shadow-shadow-shadow-3"
                scrollAreaClassName="max-h-[250px] flex-none"
                renderFile={({ depth, file, selected, children }) => {
                  const isBuildNoteFile = file.id === BUILD_NOTE_FILE_ID

                  return (
                    <AgentFileItem
                      depth={depth}
                      file={file}
                      files={visibleFiles}
                      apiContext={apiContext}
                      selected={selected}
                      onRemove={removeFile}
                    >
                      {isBuildNoteFile ? <AgentBuildNoteFileRow /> : children}
                    </AgentFileItem>
                  )
                }}
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
