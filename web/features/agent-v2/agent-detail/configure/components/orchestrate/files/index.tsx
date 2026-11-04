'use client'

import type { MouseEvent, ReactNode } from 'react'
import type { AgentOrchestrateAddActionOptions } from '../add-actions-context'
import type { AgentConfigApiContext } from '../config-context'
import type { AgentFileNode } from '@/features/agent-v2/agent-composer/form-state'
import { cn } from '@langgenius/dify-ui/cn'
import { Dialog, DialogTrigger } from '@langgenius/dify-ui/dialog'
import {
  FileTreeBadge,
  FileTreeGuide,
  FileTreeIcon,
  FileTreeLabel,
} from '@langgenius/dify-ui/file-tree'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import { Infotip, InfotipContent, InfotipTrigger } from '@langgenius/dify-ui/infotip'
import { Tooltip, TooltipContent, TooltipTrigger } from '@langgenius/dify-ui/tooltip'
import { skipToken, useMutation, useQuery } from '@tanstack/react-query'
import { noop } from 'es-toolkit/function'
import { useAtomValue, useSetAtom } from 'jotai'
import { useCallback, useId, useRef, useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { useDocLink } from '@/context/i18n'
import { agentComposerDraftAtom } from '@/features/agent-v2/agent-composer/store'
import {
  agentComposerFilesAtom,
  clearAgentConfigNoteAtom,
  removeAgentFileAtom,
  upsertAgentFilesAtom,
} from '@/features/agent-v2/agent-composer/store-modules/files'
import { hasFileDataPreview } from '@/features/agent-v2/file-icon'
import { consoleClient, consoleQuery } from '@/service/console'
import { downloadBlob, downloadUrl } from '@/utils/download'
import { useRegisterAgentOrchestrateAddAction } from '../add-actions-context'
import { ConfigureSectionAddButton } from '../common/add-button'
import { DocsLink } from '../common/docs-link'
import { ConfigureSectionEmpty } from '../common/empty'
import { MissingReferenceWarning } from '../common/missing-reference-warning'
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
  if (!configNote?.trim()) return undefined

  return {
    id: BUILD_NOTE_FILE_ID,
    icon: 'markdown',
    name: BUILD_NOTE_FILE_NAME,
    virtualContent: configNote,
  }
}

const findAgentFileNode = (files: AgentFileNode[], fileId: string): AgentFileNode | undefined => {
  for (const file of files) {
    if (file.id === fileId) return file

    const child = file.children ? findAgentFileNode(file.children, fileId) : undefined
    if (child) return child
  }
}

function AgentFileItem({
  children,
  depth,
  file,
  files,
  apiContext,
  canDownload,
  onRemove,
  selected,
}: {
  children: ReactNode
  depth: number
  file: AgentFileNode
  files: AgentFileNode[]
  apiContext: AgentConfigApiContext
  canDownload: boolean
  onRemove: (fileId: string) => void
  selected: boolean
}) {
  const { t } = useTranslation(['agentV2'])
  const { t: tCommon } = useTranslation(['common'])
  const readOnly = useAgentOrchestrateReadOnly()
  const [isPreviewOpen, setIsPreviewOpen] = useState(false)
  const [selectedFileId, setSelectedFileId] = useState<string>()
  const selectedFile = selectedFileId ? findAgentFileNode(files, selectedFileId) : undefined
  const selectedPreviewFile = selectedFile ?? file
  const isVirtualPreviewFile = selectedPreviewFile.virtualContent !== undefined
  const isBuildNoteFile = file.id === BUILD_NOTE_FILE_ID
  const previewFileId = isVirtualPreviewFile
    ? undefined
    : getAgentFilePreviewKey(selectedPreviewFile)
  const canLoadPreview = isPreviewOpen && !!previewFileId
  const isFileDataPreview = hasFileDataPreview(selectedPreviewFile.icon)
  const shouldLoadTextPreview = canLoadPreview && !isFileDataPreview
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
    enabled: shouldLoadTextPreview && !apiContext.workflow && !apiContext.trialAppId,
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
    enabled: shouldLoadTextPreview && !!apiContext.workflow,
  })
  const trialPreviewQuery = useQuery(
    consoleQuery.trialApps.byAppId.agent.config.files.byName.preview.get.queryOptions({
      input: apiContext.trialAppId
        ? {
            params: { app_id: apiContext.trialAppId, name: previewFileId ?? '' },
            query: { version_id: apiContext.versionId },
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
  const shouldDownloadPreviewFile =
    canLoadPreview && (isFileDataPreview || !!previewQuery.data?.binary)
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
    staleTime: 0,
    refetchOnWindowFocus: false,
    enabled: shouldDownloadPreviewFile && !apiContext.workflow && !apiContext.trialAppId,
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
    staleTime: 0,
    refetchOnWindowFocus: false,
    enabled: shouldDownloadPreviewFile && !!apiContext.workflow,
  })
  const trialDownloadQuery = useQuery(
    consoleQuery.trialApps.byAppId.agent.config.files.byName.download.get.queryOptions({
      input: apiContext.trialAppId
        ? {
            params: { app_id: apiContext.trialAppId, name: previewFileId ?? '' },
            query: { version_id: apiContext.versionId },
          }
        : skipToken,
      enabled: !!apiContext.trialAppId && shouldDownloadPreviewFile,
      staleTime: 0,
      refetchOnWindowFocus: false,
    }),
  )
  const downloadQuery = apiContext.trialAppId
    ? trialDownloadQuery
    : apiContext.workflow
      ? workflowDownloadQuery
      : agentDownloadQuery
  const handleRemove = useCallback(() => {
    onRemove(file.id)
  }, [file.id, onRemove])
  const downloadFile = useCallback(
    async (targetFile: AgentFileNode) => {
      if (targetFile.virtualContent !== undefined) {
        downloadBlob({
          data: new Blob([targetFile.virtualContent], { type: 'text/markdown;charset=utf-8' }),
          fileName: targetFile.name,
        })
        return
      }

      const fileName = getAgentFilePreviewKey(targetFile)
      const result = apiContext.trialAppId
        ? await consoleClient.trialApps.byAppId.agent.config.files.byName.download.get({
            params: { app_id: apiContext.trialAppId, name: fileName },
            query: { version_id: apiContext.versionId },
          })
        : apiContext.workflow
          ? await consoleClient.apps.byAppId.agent.config.files.byName.download.get({
              params: { app_id: apiContext.workflow.appId, name: fileName },
              query: {
                node_id: apiContext.workflow.nodeId,
                draft_type: apiContext.draftType,
                version_id: apiContext.versionId,
              },
            })
          : await consoleClient.agent.byAgentId.config.files.byName.download.get({
              params: { agent_id: apiContext.agentId, name: fileName },
              query: { draft_type: apiContext.draftType, version_id: apiContext.versionId },
            })
      downloadUrl({ url: result.url, fileName: targetFile.name })
    },
    [apiContext],
  )
  const downloadFileAction = useCallback(
    (targetFile: AgentFileNode) => {
      void downloadFile(targetFile).catch(noop)
    },
    [downloadFile],
  )
  const onDownloadFile = canDownload ? downloadFileAction : undefined
  const handleDownload = useCallback(
    (event: MouseEvent<HTMLButtonElement>) => {
      if (file.isMissing) return

      event.stopPropagation()
      downloadFileAction(file)
    },
    [downloadFileAction, file],
  )
  const handlePreviewOpenChange = useCallback(
    (open: boolean) => {
      if (open && file.isMissing) return

      if (open) setSelectedFileId(file.id)
      setIsPreviewOpen(open)
    },
    [file.id, file.isMissing],
  )
  const canRemoveFile = !readOnly && (!file.virtualContent || isBuildNoteFile)

  return (
    <li
      data-selected={selected || undefined}
      className="group/file-row relative flex h-6 min-w-0 items-center rounded-md focus-within:bg-state-base-hover hover:bg-state-base-hover data-selected:bg-state-base-active"
    >
      <Dialog open={isPreviewOpen} onOpenChange={handlePreviewOpenChange}>
        <DialogTrigger
          render={
            <button
              type="button"
              aria-current={selected ? 'true' : undefined}
              disabled={file.isMissing}
              className={cn(
                'group/file-tree-row relative flex h-full min-w-0 flex-1 cursor-pointer items-center rounded-md pl-2 text-left select-none focus-visible:ring-inset',
                file.isMissing && 'cursor-default pr-6',
              )}
            />
          }
        >
          {Array.from({ length: Math.max(depth - 1, 0) }, (_, index) => (
            <FileTreeGuide key={index} />
          ))}
          <div className="flex min-w-0 flex-1 items-center overflow-hidden py-0.5">{children}</div>
        </DialogTrigger>
        <AgentSkillDetailDialog
          skillName={file.name}
          detail={{
            description: t(($) => $['agentDetail.configure.files.tip']),
            files,
            filePreview: {
              binary: previewQuery.data?.binary,
              content: selectedPreviewFile.virtualContent ?? previewQuery.data?.text ?? undefined,
              downloadUrl: downloadQuery.isFetching ? undefined : downloadQuery.data?.url,
              fileName: selectedPreviewFile.name,
              fileType: selectedPreviewFile.icon,
              isDownloadError: downloadQuery.isError,
              isDownloadLoading: shouldDownloadPreviewFile && downloadQuery.isFetching,
              isError: shouldLoadTextPreview && previewQuery.isError,
              isLoading: shouldLoadTextPreview && previewQuery.isPending,
              truncated: previewQuery.data?.truncated,
            },
            onDownloadFile: onDownloadFile ? () => onDownloadFile(selectedPreviewFile) : undefined,
            onSelectFile: (selectedFile) => setSelectedFileId(selectedFile.id),
            selectedFileId: selectedFileId ?? file.id,
            sections: [],
          }}
        />
      </Dialog>
      {file.isMissing && (
        <MissingReferenceWarning
          className="absolute top-1/2 right-1 -translate-y-1/2"
          label={t(($) => $['agentDetail.configure.files.missing'])}
        />
      )}
      <div
        className={cn(
          'pointer-events-none absolute top-1/2 z-10 flex -translate-y-1/2 items-center justify-end gap-1 opacity-0 group-focus-within/file-row:pointer-events-auto group-focus-within/file-row:opacity-100 group-hover/file-row:pointer-events-auto group-hover/file-row:opacity-100',
          file.isMissing ? 'right-7' : 'right-1',
        )}
      >
        {!file.isMissing && onDownloadFile && (
          <Tooltip>
            <TooltipTrigger
              render={
                <IconButton
                  aria-label={t(($) => $['agentDetail.configure.files.download'], {
                    name: file.name,
                  })}
                  size="sm"
                  onClick={handleDownload}
                >
                  <span aria-hidden className="i-ri-download-line size-4" />
                </IconButton>
              }
            />
            <TooltipContent>{tCommon(($) => $['operation.download'])}</TooltipContent>
          </Tooltip>
        )}
        {canRemoveFile && (
          <Tooltip>
            <TooltipTrigger
              render={
                <IconButton
                  data-agent-file-remove-button
                  aria-label={t(($) => $['agentDetail.configure.files.remove'], {
                    name: file.name,
                  })}
                  size="sm"
                  tone="destructive"
                  onClick={handleRemove}
                >
                  <span aria-hidden className="i-ri-delete-bin-line size-4" />
                </IconButton>
              }
            />
            <TooltipContent>{tCommon(($) => $['operation.remove'])}</TooltipContent>
          </Tooltip>
        )}
      </div>
    </li>
  )
}

function AgentBuildNoteFileRow() {
  return (
    <>
      <FileTreeIcon type="markdown" />
      <FileTreeLabel className="w-auto flex-none" title={BUILD_NOTE_FILE_NAME}>
        {BUILD_NOTE_FILE_NAME}
      </FileTreeLabel>
      <div className="ml-1 flex shrink-0 items-center gap-0.5">
        <AgentBuildNoteBadge />
        <AgentBuildNoteInfotip />
      </div>
    </>
  )
}

function AgentBuildNoteBadge() {
  const { t } = useTranslation(['agentV2'])

  return (
    <FileTreeBadge className="ms-0 gap-0.5 px-1 py-0.5">
      <span aria-hidden className="i-ri-sparkling-line size-3 shrink-0" />
      <span>{t(($) => $['agentDetail.configure.files.buildNote.generated'])}</span>
    </FileTreeBadge>
  )
}

function AgentBuildNoteInfotip() {
  const docLink = useDocLink()

  return (
    <Infotip>
      <InfotipTrigger aria-label={BUILD_NOTE_FILE_NAME} iconSize="large" />
      <InfotipContent aria-label={BUILD_NOTE_FILE_NAME}>
        <Trans
          i18nKey={($) => $['agentDetail.configure.files.buildNote.richTooltip']}
          ns="agentV2"
          components={{
            docLink: <DocsLink href={docLink('/use-dify/build/new-agent/build#the-build-note')} />,
          }}
        />
      </InfotipContent>
    </Infotip>
  )
}

export function AgentFiles() {
  const { t } = useTranslation(['agentV2'])

  const filesTreeId = 'agent-configure-files-tree'
  const readOnly = useAgentOrchestrateReadOnly()
  const [isUploadOpen, setIsUploadOpen] = useState(false)
  const promptAddCallbackRef = useRef<AgentOrchestrateAddActionOptions['onAdded']>(undefined)
  const uploadedFilesRef = useRef<AgentFileNode[]>([])
  const apiContext = useAgentConfigApiContext()
  const draft = useAtomValue(agentComposerDraftAtom)
  const files = useAtomValue(agentComposerFilesAtom)
  const clearAgentConfigNote = useSetAtom(clearAgentConfigNoteAtom)
  const removeAgentFile = useSetAtom(removeAgentFileAtom)
  const upsertAgentFiles = useSetAtom(upsertAgentFilesAtom)
  const buildNoteFile = getBuildNoteFile(draft.configNote)
  const visibleFiles = buildNoteFile ? [buildNoteFile, ...files] : files
  const previewFiles = visibleFiles.filter((file) => !file.isMissing)
  const { mutate: deleteAgentFile } = useMutation(
    consoleQuery.agent.byAgentId.config.files.byName.delete.mutationOptions(),
  )
  const { mutate: deleteWorkflowAgentFile } = useMutation(
    consoleQuery.apps.byAppId.agent.config.files.byName.delete.mutationOptions(),
  )
  const removeFile = useCallback(
    (fileId: string) => {
      if (fileId === BUILD_NOTE_FILE_ID) {
        clearAgentConfigNote()
        return
      }

      const file = findAgentFileNode(files, fileId)
      const configName = file?.configName ?? file?.name

      if (!configName) return

      const onSuccess = () => {
        removeAgentFile(fileId)
      }
      if (apiContext.workflow) {
        deleteWorkflowAgentFile(
          {
            params: {
              app_id: apiContext.workflow.appId,
              name: configName,
            },
            query: {
              node_id: apiContext.workflow.nodeId,
              draft_type: apiContext.draftType,
              version_id: apiContext.versionId,
            },
          },
          { onSuccess },
        )
        return
      }

      deleteAgentFile(
        {
          params: {
            agent_id: apiContext.agentId,
            name: configName,
          },
          query: {
            draft_type: apiContext.draftType,
            version_id: apiContext.versionId,
          },
        },
        { onSuccess },
      )
    },
    [
      apiContext,
      clearAgentConfigNote,
      deleteAgentFile,
      deleteWorkflowAgentFile,
      files,
      removeAgentFile,
    ],
  )
  const handleOpenUpload = useCallback((options?: AgentOrchestrateAddActionOptions) => {
    promptAddCallbackRef.current = options?.onAdded
    setIsUploadOpen(true)
  }, [])
  useRegisterAgentOrchestrateAddAction('files', handleOpenUpload)
  const handleUploaded = useCallback(
    (uploadedFiles: AgentFileNode[]) => {
      upsertAgentFiles(uploadedFiles)
      uploadedFilesRef.current.push(...uploadedFiles)
    },
    [upsertAgentFiles],
  )
  const handleUploadOpenChange = useCallback((open: boolean) => {
    if (!open) {
      if (uploadedFilesRef.current.length > 0)
        promptAddCallbackRef.current?.(uploadedFilesRef.current)
      promptAddCallbackRef.current = undefined
      uploadedFilesRef.current = []
    }
    setIsUploadOpen(open)
  }, [])

  return (
    <>
      <ConfigureSection
        label={t(($) => $['agentDetail.configure.files.label'])}
        labelId="agent-configure-files-label"
        buildDraftChangeSection="files"
        tip={<AgentConfigureTipContent type="files" />}
        actions={
          !readOnly ? (
            <ConfigureSectionAddButton
              ariaLabel={t(($) => $['agentDetail.configure.files.add'])}
              onClick={() => handleOpenUpload()}
            />
          ) : undefined
        }
      >
        {visibleFiles.length === 0 ? (
          <ConfigureSectionEmpty
            title={t(($) => $['agentDetail.configure.files.empty.title'])}
            description={t(($) => $['agentDetail.configure.files.empty.description'])}
          />
        ) : (
          <AgentFileTree
            id={filesTreeId}
            files={visibleFiles}
            treeLabel={t(($) => $['agentDetail.configure.files.treeLabel'])}
            className="rounded-lg border-[0.5px] border-components-panel-border bg-components-panel-on-panel-item-bg p-1 shadow-xs shadow-shadow-shadow-3"
            scrollAreaClassName="max-h-[250px] flex-none"
            renderFile={({ depth, file, selected, children }) => {
              const isBuildNoteFile = file.id === BUILD_NOTE_FILE_ID

              return (
                <AgentFileItem
                  depth={depth}
                  file={file}
                  files={previewFiles}
                  apiContext={apiContext}
                  canDownload
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

export function AgentTemplateFiles() {
  const { t } = useTranslation(['agentV2'])
  const labelId = useId()
  const apiContext = useAgentConfigApiContext()
  const draft = useAtomValue(agentComposerDraftAtom)
  const files = useAtomValue(agentComposerFilesAtom)
  const buildNote = getBuildNoteFile(draft.configNote)
  const visibleFiles = buildNote ? [buildNote, ...files] : files
  const previewFiles = visibleFiles.filter((file) => !file.isMissing)

  return (
    <ConfigureSection
      label={t(($) => $['agentDetail.configure.files.label'])}
      labelId={labelId}
      tip={<AgentConfigureTipContent type="files" />}
    >
      {visibleFiles.length === 0 ? (
        <ConfigureSectionEmpty
          title={t(($) => $['agentDetail.configure.files.empty.title'])}
          description={t(($) => $['agentDetail.configure.files.empty.description'])}
        />
      ) : (
        <AgentFileTree
          files={visibleFiles}
          treeLabelledBy={labelId}
          className="rounded-lg border-[0.5px] border-components-panel-border bg-components-panel-on-panel-item-bg p-1 shadow-xs shadow-shadow-shadow-3"
          scrollAreaClassName="max-h-[250px] flex-none"
          renderFile={({ depth, file, selected, children }) => (
            <AgentFileItem
              depth={depth}
              file={file}
              files={previewFiles}
              apiContext={apiContext}
              canDownload={false}
              selected={selected}
              onRemove={noop}
            >
              {file.id === BUILD_NOTE_FILE_ID ? <AgentBuildNoteFileRow /> : children}
            </AgentFileItem>
          )}
        />
      )}
    </ConfigureSection>
  )
}
