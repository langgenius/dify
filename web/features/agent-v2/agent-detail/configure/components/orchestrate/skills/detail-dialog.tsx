'use client'
import type { ReactNode } from 'react'
import type { AgentFileNode } from '@/features/agent-v2/agent-composer/form-state'
import { cn } from '@langgenius/dify-ui/cn'
import {
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@langgenius/dify-ui/dialog'
import { FileTreeFile } from '@langgenius/dify-ui/file-tree'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import {
  ScrollArea,
  ScrollAreaContent,
  ScrollAreaScrollbar,
  ScrollAreaThumb,
  ScrollAreaViewport,
} from '@langgenius/dify-ui/scroll-area'
import { Tooltip, TooltipContent, TooltipTrigger } from '@langgenius/dify-ui/tooltip'
import { queryOptions, useQuery } from '@tanstack/react-query'
import dynamic from 'next/dynamic'
import { useCallback, useId, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { LoadingPlaceholder } from '@/app/components/base/loading-placeholder'
import { getFileExtension, hasFileDataPreview } from '@/features/agent-v2/file-icon'
import { AgentFileTree } from '../files/tree'

type AgentSkillDetailSection = {
  id: string
  title: string
  paragraphs?: string[]
  items?: string[]
}

export type AgentSkillDetailDownloadAction = 'header' | 'preview'

export type AgentSkillDetail = {
  description: string
  fileCount?: number
  fileListHeader?: ReactNode
  fileListLoading?: boolean
  fileListPanelClassName?: string
  fileListTreeClassName?: string
  fileListTreeListClassName?: string
  fileListTitle?: string
  files: AgentFileNode[]
  folderOpenState?: (context: { file: AgentFileNode; depth: number }) => boolean
  filePreview?: {
    binary?: boolean
    content?: string
    downloadActionLoadingTarget?: AgentSkillDetailDownloadAction | null
    downloadUrl?: string
    fileData?: Blob
    fileName?: string
    fileType?: AgentFileNode['icon']
    isDownloadError?: boolean
    isDownloadLoading?: boolean
    isError?: boolean
    isLoading?: boolean
    truncated?: boolean
  }
  onFolderOpenChange?: (context: { file: AgentFileNode; depth: number; open: boolean }) => void
  onFolderEnter?: (context: { file: AgentFileNode; depth: number }) => void
  onDownloadFile?: (action: AgentSkillDetailDownloadAction) => void
  onSelectFile?: (file: AgentFileNode) => void
  renderFolderSuffix?: (context: { file: AgentFileNode; depth: number }) => ReactNode
  selectedFileId?: string
  sections: AgentSkillDetailSection[]
}

const keepSkillFoldersClosed = () => false

const AgentFilePdfPreview = dynamic(
  () => import('./pdf-preview').then((module) => module.AgentFilePdfPreview),
  { ssr: false, loading: () => <AgentFilePreviewLoading /> },
)

function AgentSkillFileList({
  fileListHeader,
  fileListLoading,
  fileListTreeClassName,
  fileListTreeListClassName,
  fileListTitle,
  files,
  folderOpenState,
  onFolderOpenChange,
  onFolderEnter,
  onSelectFile,
  renderFolderSuffix,
  selectedFileId,
}: {
  fileListHeader?: ReactNode
  fileListLoading?: boolean
  fileListTreeClassName?: string
  fileListTreeListClassName?: string
  fileListTitle?: string
  files: AgentFileNode[]
  folderOpenState?: AgentSkillDetail['folderOpenState']
  onFolderOpenChange?: AgentSkillDetail['onFolderOpenChange']
  onFolderEnter?: AgentSkillDetail['onFolderEnter']
  onSelectFile?: (file: AgentFileNode) => void
  renderFolderSuffix?: AgentSkillDetail['renderFolderSuffix']
  selectedFileId?: string
}) {
  const { t } = useTranslation(['agentV2'])

  if (fileListLoading) {
    return (
      <div className={cn('flex h-full flex-col bg-background-section', fileListTreeClassName)}>
        {fileListHeader ?? (
          <h3
            id="agent-skill-detail-files-heading"
            className="px-4 pt-3.5 pb-3 system-xl-semibold text-text-primary"
          >
            {fileListTitle ?? t(($) => $['agentDetail.configure.skills.detail.files'])}
          </h3>
        )}
        <div className="flex min-h-0 flex-1 items-center justify-center">
          <LoadingPlaceholder />
        </div>
      </div>
    )
  }

  return (
    <AgentFileTree
      files={files}
      selectedFileId={selectedFileId}
      treeLabelledBy="agent-skill-detail-files-heading"
      className={cn('h-full bg-background-section p-1', fileListTreeClassName)}
      listClassName={fileListTreeListClassName}
      scrollAreaClassName="flex-1"
      folderOpenStrategy={keepSkillFoldersClosed}
      folderOpenState={folderOpenState}
      onFolderOpenChange={onFolderOpenChange}
      onFolderEnter={onFolderEnter}
      renderFile={
        onSelectFile
          ? ({ depth, file, selected, children }) => (
              <FileTreeFile level={depth} selected={selected} onClick={() => onSelectFile(file)}>
                {children}
              </FileTreeFile>
            )
          : undefined
      }
      renderFolderSuffix={renderFolderSuffix}
      header={
        fileListHeader ?? (
          <h3
            id="agent-skill-detail-files-heading"
            className="px-4 pt-3.5 pb-3 system-xl-semibold text-text-primary"
          >
            {fileListTitle ?? t(($) => $['agentDetail.configure.skills.detail.files'])}
          </h3>
        )
      }
    />
  )
}

function AgentSkillDetailSectionBlock({ section }: { section: AgentSkillDetailSection }) {
  return (
    <section className="clear-none">
      <h3 className="system-sm-semibold text-text-primary">{section.title}</h3>
      {section.paragraphs?.map((paragraph) => (
        <p key={paragraph} className="mt-1 system-xs-regular text-text-secondary">
          {paragraph}
        </p>
      ))}
      {!!section.items?.length && (
        <ul className="mt-1 flex list-disc flex-col gap-0.5 pl-5 system-xs-regular text-text-secondary">
          {section.items.map((item) => (
            <li key={item} className="pl-0.5">
              {item}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function AgentSkillImagePreview({ fileName, fileData }: { fileName?: string; fileData: Blob }) {
  const setImageRef = useCallback(
    (image: HTMLImageElement | null) => {
      if (!image) return

      const objectUrl = URL.createObjectURL(fileData)
      image.src = objectUrl

      return () => {
        URL.revokeObjectURL(objectUrl)
      }
    },
    [fileData],
  )

  return (
    <div className="flex min-h-40 flex-1 items-start justify-center overflow-auto px-2 pb-4">
      <img
        ref={setImageRef}
        alt={fileName ?? ''}
        className="max-h-140 max-w-full rounded-lg object-contain"
      />
    </div>
  )
}

function AgentFilePreviewLoading() {
  return (
    <div className="flex min-h-40 flex-1 items-center justify-center">
      <LoadingPlaceholder />
    </div>
  )
}

function AgentFilePreviewFallback({
  downloadActionLoadingTarget,
  downloadUrl,
  message,
  onDownloadFile,
}: Pick<
  NonNullable<AgentSkillDetail['filePreview']>,
  'downloadActionLoadingTarget' | 'downloadUrl'
> &
  Pick<AgentSkillDetail, 'onDownloadFile'> & { message: string }) {
  const { t: tCommon } = useTranslation(['common'])
  const isPreviewDownloadLoading = downloadActionLoadingTarget === 'preview'

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2 px-4">
      <span className="system-sm-regular text-text-tertiary">{message}</span>
      {onDownloadFile && (
        <a
          href={downloadUrl || '#'}
          aria-disabled={isPreviewDownloadLoading}
          onClick={(event) => {
            if (isPreviewDownloadLoading) {
              event.preventDefault()
              return
            }
            if (!downloadUrl) {
              event.preventDefault()
              onDownloadFile('preview')
            }
          }}
          target="_blank"
          rel="noreferrer"
          className="inline-flex min-w-0 items-center gap-1 rounded-md px-2 py-1 system-sm-medium text-text-accent outline-hidden hover:bg-state-base-hover focus-visible:ring-2 focus-visible:ring-state-accent-solid"
        >
          <span
            aria-hidden
            className={cn(
              'size-4 shrink-0',
              isPreviewDownloadLoading
                ? 'i-ri-loader-2-line animate-spin motion-reduce:animate-none'
                : 'i-ri-download-2-line',
            )}
          />
          <span className="shrink-0">
            {isPreviewDownloadLoading
              ? tCommon(($) => $['operation.downloading'])
              : tCommon(($) => $['operation.download'])}
          </span>
        </a>
      )}
    </div>
  )
}

function AgentFilePreviewContent({
  binary,
  content,
  downloadActionLoadingTarget,
  downloadUrl,
  fileData,
  fileName,
  fileType,
  isDownloadError,
  isDownloadLoading,
  isError,
  isLoading,
  onDownloadFile,
  truncated,
}: NonNullable<AgentSkillDetail['filePreview']> & Pick<AgentSkillDetail, 'onDownloadFile'>) {
  const { t } = useTranslation(['agentV2'])

  if (isLoading || isDownloadLoading) return <AgentFilePreviewLoading />

  if (isError || isDownloadError) {
    return (
      <p className="px-4 system-sm-regular text-text-tertiary">
        {t(($) => $['agentDetail.configure.files.preview.failed'])}
      </p>
    )
  }

  if (fileType === 'image' && fileData)
    return <AgentSkillImagePreview fileName={fileName} fileData={fileData} />

  if (fileType === 'image' && downloadUrl) {
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

  if (fileType === 'pdf' && (fileData || downloadUrl)) {
    return (
      <AgentFilePdfPreview
        data={fileData}
        url={downloadUrl}
        loading={<AgentFilePreviewLoading />}
        failure={
          <AgentFilePreviewFallback
            downloadActionLoadingTarget={downloadActionLoadingTarget}
            message={t(($) => $['agentDetail.configure.files.preview.failed'])}
            onDownloadFile={onDownloadFile}
          />
        }
      />
    )
  }

  if (binary || hasFileDataPreview(fileType)) {
    return (
      <AgentFilePreviewFallback
        downloadActionLoadingTarget={downloadActionLoadingTarget}
        downloadUrl={downloadUrl}
        message={t(($) => $['agentDetail.configure.files.preview.unsupported'])}
        onDownloadFile={onDownloadFile}
      />
    )
  }

  if (!content) {
    return (
      <p className="px-4 system-sm-regular text-text-tertiary">
        {t(($) => $['agentDetail.configure.files.preview.empty'])}
      </p>
    )
  }

  return (
    <>
      {truncated && (
        <p className="flex items-center gap-1 px-4 system-xs-regular text-text-tertiary">
          <span aria-hidden className="i-ri-information-line size-3.5 shrink-0" />
          {t(($) => $['agentDetail.configure.files.preview.truncated'])}
        </p>
      )}
      <AgentFileTextPreview content={content} fileName={fileName} />
    </>
  )
}

const loadFileHighlighter = async () => {
  const [{ codeToTokens, isSupportedLanguage }, { default: light }, { default: dark }] =
    await Promise.all([
      import('@pierre/highlights'),
      import('@pierre/highlights/themes/github-light'),
      import('@pierre/highlights/themes/github-dark'),
    ])

  return (code: string, lang: string) => {
    if (!isSupportedLanguage(lang)) return undefined

    try {
      return codeToTokens(code, {
        lang,
        themes: { light, dark },
        defaultColor: false,
        tokenizeMaxLineLength: 1000,
      }).tokens
    } catch {
      return undefined
    }
  }
}

function AgentFileTextPreview({ content, fileName }: { content: string; fileName?: string }) {
  const extension = fileName ? getFileExtension(fileName) : ''
  const language = extension && extension !== 'txt' ? extension : undefined
  const { data: highlight } = useQuery(
    queryOptions({
      queryKey: ['agent-v2', 'file-highlighter'],
      queryFn: loadFileHighlighter,
      enabled: !!language,
      networkMode: 'always',
      staleTime: Infinity,
    }),
  )
  const highlightedLines = useMemo(
    () => (highlight && language ? highlight(content, language) : undefined),
    [content, highlight, language],
  )
  const lines = content.split('\n').map((line, index) => ({
    content: line,
    key: `${index}:${line}`,
    lineNumber: String(index + 1).padStart(2, '0'),
    tokens: highlightedLines?.[index],
  }))

  return (
    <div className="min-h-0 flex-1 overflow-auto px-2 pb-4 font-mono text-[13px] leading-5.5">
      {lines.map((line) => (
        <div key={line.key} className="flex min-w-0 items-start">
          <span
            aria-hidden="true"
            className="w-7 shrink-0 pr-2 text-right text-text-quaternary select-none"
          >
            {line.lineNumber}
          </span>
          <code className="block min-w-0 flex-1 wrap-anywhere whitespace-pre-wrap text-text-primary">
            {line.tokens
              ? line.tokens.map((token, tokenIndex) => (
                  <span
                    // oxlint-disable-next-line react/no-array-index-key -- Tokens are positional within their line.
                    key={tokenIndex}
                    style={token.htmlStyle}
                    className="[font-weight:var(--hls-light-font-weight)] text-(--hls-light) [font-style:var(--hls-light-font-style)] in-data-[theme=dark]:[font-weight:var(--hls-dark-font-weight)] in-data-[theme=dark]:text-(--hls-dark) in-data-[theme=dark]:[font-style:var(--hls-dark-font-style)]"
                  >
                    {token.content}
                  </span>
                ))
              : line.content}
          </code>
        </div>
      ))}
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
  return (
    <DialogContent
      backdropProps={{ forceRender: true, className: 'fixed' }}
      className="h-[min(720px,calc(100dvh-2rem))] w-[min(960px,calc(100vw-2rem))] overflow-hidden"
    >
      <AgentSkillDetailBody skillName={skillName} detail={detail} />
    </DialogContent>
  )
}

export function AgentSkillDetailBody({
  skillName,
  detail,
}: {
  skillName: string
  detail: AgentSkillDetail
}) {
  const { t: tCommon } = useTranslation(['common'])
  const dialogTitleId = useId()
  const previewTitle = detail.filePreview?.fileName
  const isHeaderDownloadLoading = detail.filePreview?.downloadActionLoadingTarget === 'header'
  const headerDownloadLabel = isHeaderDownloadLoading
    ? tCommon(($) => $['operation.downloading'])
    : tCommon(($) => $['operation.download'])

  return (
    <>
      <div className="flex min-h-0 flex-1">
        <div
          className={cn(
            'flex w-56 min-w-0 shrink-0 border-r-[0.5px] border-divider-subtle bg-background-section',
            detail.fileListPanelClassName,
          )}
        >
          <DialogDescription className="sr-only">{detail.description}</DialogDescription>
          <DialogTitle id={dialogTitleId} className="sr-only">
            {previewTitle || skillName}
          </DialogTitle>
          <div className="min-h-0 w-full">
            <AgentSkillFileList
              fileListHeader={detail.fileListHeader}
              fileListLoading={detail.fileListLoading}
              fileListTreeClassName={detail.fileListTreeClassName}
              fileListTreeListClassName={detail.fileListTreeListClassName}
              fileListTitle={detail.fileListTitle}
              files={detail.files}
              folderOpenState={detail.folderOpenState}
              onFolderOpenChange={detail.onFolderOpenChange}
              onFolderEnter={detail.onFolderEnter}
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
                <h2
                  className="min-w-0 truncate system-xl-semibold text-text-primary"
                  title={previewTitle}
                >
                  {previewTitle}
                </h2>
              )}
            </div>
            <div className="-my-0.5 flex shrink-0 items-center gap-1">
              {detail.onDownloadFile && previewTitle && (
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <IconButton
                        aria-label={`${headerDownloadLabel} ${previewTitle}`}
                        size="lg"
                        className="shrink-0"
                        disabled={isHeaderDownloadLoading}
                        focusableWhenDisabled
                        onClick={() => detail.onDownloadFile?.('header')}
                      >
                        <span
                          aria-hidden
                          className={cn(
                            'size-4',
                            isHeaderDownloadLoading
                              ? 'i-ri-loader-2-line animate-spin motion-reduce:animate-none'
                              : 'i-ri-download-line',
                          )}
                        />
                      </IconButton>
                    }
                  />
                  <TooltipContent>{headerDownloadLabel}</TooltipContent>
                </Tooltip>
              )}
              <DialogClose
                render={
                  <IconButton
                    aria-label={tCommon(($) => $['operation.close'])}
                    size="lg"
                    className="shrink-0"
                  >
                    <span aria-hidden className="i-ri-close-line size-4" />
                  </IconButton>
                }
              />
            </div>
          </div>
          <ScrollArea className="min-h-0 flex-1 overflow-hidden rounded-br-2xl">
            <ScrollAreaViewport
              aria-labelledby={dialogTitleId}
              className="overscroll-contain"
              role="region"
            >
              <ScrollAreaContent
                style={{ minWidth: 0 }}
                className="flex min-h-full w-full max-w-full flex-col gap-2"
              >
                {detail.filePreview && (
                  <AgentFilePreviewContent
                    {...detail.filePreview}
                    onDownloadFile={detail.onDownloadFile}
                  />
                )}
                {detail.sections.map((section) => (
                  <div key={section.id} className="px-4">
                    <AgentSkillDetailSectionBlock section={section} />
                  </div>
                ))}
              </ScrollAreaContent>
            </ScrollAreaViewport>
            <ScrollAreaScrollbar>
              <ScrollAreaThumb />
            </ScrollAreaScrollbar>
          </ScrollArea>
        </div>
      </div>
    </>
  )
}
