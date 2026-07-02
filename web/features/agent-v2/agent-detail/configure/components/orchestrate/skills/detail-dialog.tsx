'use client'

import type { ReactNode } from 'react'
import type { AgentFileNode } from '@/features/agent-v2/agent-composer/form-state'
import { cn } from '@langgenius/dify-ui/cn'
import {
  DialogCloseButton,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@langgenius/dify-ui/dialog'
import { FileTreeFile } from '@langgenius/dify-ui/file-tree'
import { ScrollArea } from '@langgenius/dify-ui/scroll-area'
import { useTranslation } from 'react-i18next'
import Loading from '@/app/components/base/loading'
import { AgentFileTree } from '../files/tree'

type AgentSkillFileNode = AgentFileNode

type AgentSkillDetailSection = {
  id: string
  title: string
  paragraphs?: string[]
  items?: string[]
}

export type AgentSkillDetail = {
  description: string
  fileCount?: number
  fileListHeader?: ReactNode
  fileListPanelClassName?: string
  fileListTreeClassName?: string
  fileListTreeListClassName?: string
  fileListTitle?: string
  files: AgentSkillFileNode[]
  folderOpenState?: (context: { file: AgentSkillFileNode, depth: number }) => boolean
  filePreview?: {
    binary?: boolean
    content?: string
    downloadUrl?: string
    fileName?: string
    isDownloadError?: boolean
    isDownloadLoading?: boolean
    isError?: boolean
    isImage?: boolean
    isLoading?: boolean
  }
  onFolderOpenChange?: (context: { file: AgentSkillFileNode, depth: number, open: boolean }) => void
  onFolderDoubleClick?: (context: { file: AgentSkillFileNode, depth: number }) => void
  onSelectFile?: (file: AgentSkillFileNode) => void
  renderFolderSuffix?: (context: { file: AgentSkillFileNode, depth: number }) => ReactNode
  selectedFileId?: string
  sections: AgentSkillDetailSection[]
}

const keepSkillFoldersClosed = () => false

function AgentSkillFileList({
  fileListHeader,
  fileListTreeClassName,
  fileListTreeListClassName,
  fileListTitle,
  files,
  folderOpenState,
  onFolderOpenChange,
  onFolderDoubleClick,
  onSelectFile,
  renderFolderSuffix,
  selectedFileId,
}: {
  fileListHeader?: ReactNode
  fileListTreeClassName?: string
  fileListTreeListClassName?: string
  fileListTitle?: string
  files: AgentSkillFileNode[]
  folderOpenState?: AgentSkillDetail['folderOpenState']
  onFolderOpenChange?: AgentSkillDetail['onFolderOpenChange']
  onFolderDoubleClick?: AgentSkillDetail['onFolderDoubleClick']
  onSelectFile?: (file: AgentSkillFileNode) => void
  renderFolderSuffix?: AgentSkillDetail['renderFolderSuffix']
  selectedFileId?: string
}) {
  const { t } = useTranslation('agentV2')

  return (
    <AgentFileTree
      files={files}
      selectedFileId={selectedFileId}
      labelledBy="agent-skill-detail-files-heading"
      className={cn('h-full bg-background-section p-1', fileListTreeClassName)}
      listClassName={fileListTreeListClassName}
      scrollAreaClassName="flex-1"
      folderOpenStrategy={keepSkillFoldersClosed}
      folderOpenState={folderOpenState}
      onFolderOpenChange={onFolderOpenChange}
      onFolderDoubleClick={onFolderDoubleClick}
      renderFile={onSelectFile
        ? ({ depth, file, selected, children }) => (
            <FileTreeFile level={depth} selected={selected} onClick={() => onSelectFile(file)}>
              {children}
            </FileTreeFile>
          )
        : undefined}
      renderFolderSuffix={renderFolderSuffix}
      header={(
        fileListHeader ?? (
          <h3 id="agent-skill-detail-files-heading" className="px-4 pt-3.5 pb-3 system-xl-semibold text-text-primary">
            {fileListTitle ?? t('agentDetail.configure.skills.detail.files')}
          </h3>
        )
      )}
    />
  )
}

function AgentSkillDetailSectionBlock({
  section,
}: {
  section: AgentSkillDetailSection
}) {
  return (
    <section className="clear-none">
      <h3 className="system-sm-semibold text-text-primary">{section.title}</h3>
      {section.paragraphs?.map(paragraph => (
        <p key={paragraph} className="mt-1 system-xs-regular text-text-secondary">
          {paragraph}
        </p>
      ))}
      {!!section.items?.length && (
        <ul className="mt-1 flex list-disc flex-col gap-0.5 pl-5 system-xs-regular text-text-secondary">
          {section.items.map(item => (
            <li key={item} className="pl-0.5">
              {item}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function AgentFilePreviewContent({
  binary,
  content,
  downloadUrl,
  fileName,
  isDownloadError,
  isDownloadLoading,
  isError,
  isImage,
  isLoading,
}: {
  binary?: boolean
  content?: string
  downloadUrl?: string
  fileName?: string
  isDownloadError?: boolean
  isDownloadLoading?: boolean
  isError?: boolean
  isImage?: boolean
  isLoading?: boolean
}) {
  const { t } = useTranslation('agentV2')
  const { t: tCommon } = useTranslation('common')

  if (isLoading || isDownloadLoading) {
    return (
      <div className="flex min-h-40 flex-1 items-center justify-center">
        <Loading type="area" />
      </div>
    )
  }

  if (isError || isDownloadError) {
    return (
      <p className="px-4 system-sm-regular text-text-tertiary">
        {t('agentDetail.configure.files.preview.failed')}
      </p>
    )
  }

  if (isImage && downloadUrl) {
    return (
      <div className="flex min-h-40 flex-1 items-start justify-center overflow-auto px-2 pb-4">
        <img
          src={downloadUrl}
          alt={fileName ?? ''}
          className="max-h-140 max-w-full rounded-lg object-contain"
        />
      </div>
    )
  }

  if (binary) {
    if (downloadUrl) {
      return (
        <div className="flex min-w-0 flex-wrap items-center gap-2 px-4">
          <span className="system-sm-regular text-text-tertiary">
            {t('agentDetail.configure.files.preview.unsupported')}
          </span>
          <a
            href={downloadUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex min-w-0 items-center gap-1 rounded-md px-2 py-1 system-sm-medium text-text-accent outline-hidden hover:bg-state-base-hover focus-visible:ring-2 focus-visible:ring-state-accent-solid"
          >
            <span aria-hidden className="i-ri-download-2-line size-4 shrink-0" />
            <span className="shrink-0">{tCommon('operation.download')}</span>
          </a>
        </div>
      )
    }

    return (
      <p className="px-4 system-sm-regular text-text-tertiary">
        {t('agentDetail.configure.files.preview.empty')}
      </p>
    )
  }

  if (!content) {
    return (
      <p className="px-4 system-sm-regular text-text-tertiary">
        {t('agentDetail.configure.files.preview.empty')}
      </p>
    )
  }

  const lines = content.split('\n')

  return (
    <div className="flex min-h-0 flex-1 overflow-auto px-2 pb-4">
      <pre
        aria-hidden="true"
        className="m-0 w-7 shrink-0 pr-2 text-right font-mono text-[13px] leading-[22px] text-text-quaternary select-none"
      >
        {lines.map((_, index) => String(index + 1).padStart(2, '0')).join('\n')}
      </pre>
      <pre className="m-0 min-w-max flex-1 font-mono text-[13px] leading-[22px] whitespace-pre text-text-primary">
        {content}
      </pre>
    </div>
  )
}

export function AgentSkillDetailDialog({
  skillName,
  detail,
}: {
  skillName: string
  detail: AgentSkillDetail
}) {
  const { t } = useTranslation('agentV2')
  const previewTitle = detail.filePreview?.fileName

  return (
    <DialogContent backdropProps={{ forceRender: true }} backdropClassName="fixed" className="flex h-[min(720px,calc(100dvh-2rem))] max-h-none w-[min(960px,calc(100vw-2rem))] flex-row overflow-hidden rounded-2xl p-0">
      <div className={cn('flex w-56 min-w-0 shrink-0 border-r-[0.5px] border-divider-subtle bg-background-section', detail.fileListPanelClassName)}>
        <DialogDescription className="sr-only">
          {detail.description}
        </DialogDescription>
        <DialogTitle className="sr-only">
          {previewTitle || skillName}
        </DialogTitle>
        <div className="min-h-0 w-full">
          <AgentSkillFileList
            fileListHeader={detail.fileListHeader}
            fileListTreeClassName={detail.fileListTreeClassName}
            fileListTreeListClassName={detail.fileListTreeListClassName}
            fileListTitle={detail.fileListTitle}
            files={detail.files}
            folderOpenState={detail.folderOpenState}
            onFolderOpenChange={detail.onFolderOpenChange}
            onFolderDoubleClick={detail.onFolderDoubleClick}
            selectedFileId={detail.selectedFileId}
            onSelectFile={detail.onSelectFile}
            renderFolderSuffix={detail.renderFolderSuffix}
          />
        </div>
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex shrink-0 items-start gap-2 px-4 pt-3.5 pb-2">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            {!!previewTitle && (
              <h2 className="min-w-0 truncate system-xl-semibold text-text-primary" title={previewTitle}>
                {previewTitle}
              </h2>
            )}
          </div>
          <DialogCloseButton className="static size-7 shrink-0 rounded-md" />
        </div>
        <ScrollArea
          className="relative min-h-0 flex-1 overflow-hidden has-[>_:first-child:focus-visible]:outline-2 has-[>_:first-child:focus-visible]:outline-offset-0 has-[>_:first-child:focus-visible]:outline-state-accent-solid"
          label={t('agentDetail.configure.skills.detail.contentRegion')}
          slotClassNames={{
            viewport: 'overscroll-contain outline-none focus-visible:outline-none',
            content: 'flex min-h-full w-full max-w-full min-w-0 flex-col gap-2',
          }}
        >
          {detail.filePreview && (
            <AgentFilePreviewContent
              binary={detail.filePreview.binary}
              content={detail.filePreview.content}
              downloadUrl={detail.filePreview.downloadUrl}
              fileName={detail.filePreview.fileName}
              isDownloadError={detail.filePreview.isDownloadError}
              isDownloadLoading={detail.filePreview.isDownloadLoading}
              isError={detail.filePreview.isError}
              isImage={detail.filePreview.isImage}
              isLoading={detail.filePreview.isLoading}
            />
          )}
          {detail.sections.map(section => (
            <div key={section.id} className="px-4">
              <AgentSkillDetailSectionBlock section={section} />
            </div>
          ))}
        </ScrollArea>
      </div>
    </DialogContent>
  )
}
