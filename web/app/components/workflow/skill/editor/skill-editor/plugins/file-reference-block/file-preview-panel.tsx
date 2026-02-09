import type { FileAppearanceType } from '@/app/components/base/file-uploader/types'
import type { AppAssetTreeView } from '@/types/app-asset'
import { RiCloseLine, RiExternalLinkLine, RiFolderLine } from '@remixicon/react'
import * as React from 'react'
import { useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useStore as useAppStore } from '@/app/components/app/store'
import FileTypeIcon from '@/app/components/base/file-uploader/file-type-icon'
import Loading from '@/app/components/base/loading'
import Tooltip from '@/app/components/base/tooltip'
import SkillEditor from '@/app/components/workflow/skill/editor/skill-editor'
import { useFileTypeInfo } from '@/app/components/workflow/skill/hooks/use-file-type-info'
import { getFileIconType } from '@/app/components/workflow/skill/utils/file-utils'
import ReadOnlyFilePreview from '@/app/components/workflow/skill/viewer/read-only-file-preview'
import { useGetAppAssetFileContent, useGetAppAssetFileDownloadUrl } from '@/service/use-app-asset'
import { cn } from '@/utils/classnames'

type FilePreviewPanelProps = {
  resourceId: string
  currentNode?: AppAssetTreeView
  className?: string
  style?: React.CSSProperties
  onClose?: () => void
}

const FilePreviewPanel = ({ resourceId, currentNode, className, style, onClose }: FilePreviewPanelProps) => {
  const { t } = useTranslation(['workflow', 'common'])
  const appId = useAppStore(s => s.appDetail?.id || '')

  const isFolder = currentNode?.node_type === 'folder'
  const isPreviewEnabled = !isFolder && Boolean(appId && resourceId)
  const { isMarkdown } = useFileTypeInfo(isPreviewEnabled ? currentNode : undefined)
  const isMarkdownPreview = isPreviewEnabled && isMarkdown
  const isReadOnlyPreview = isPreviewEnabled && !isMarkdown

  const {
    data: fileContent,
    isLoading: isContentLoading,
    error: contentError,
  } = useGetAppAssetFileContent(appId, resourceId, {
    enabled: isMarkdownPreview,
  })

  const {
    data: downloadUrlData,
    isLoading: isDownloadLoading,
    error: downloadError,
  } = useGetAppAssetFileDownloadUrl(appId, resourceId, {
    enabled: isReadOnlyPreview,
  })

  const content = useMemo(() => {
    if (!isMarkdownPreview || !fileContent)
      return ''
    if (typeof fileContent?.content === 'string')
      return fileContent.content
    return JSON.stringify(fileContent, null, 2)
  }, [fileContent, isMarkdownPreview])

  const pathSegments = useMemo(
    () => (currentNode?.path ?? '').split('/').filter(Boolean),
    [currentNode?.path],
  )

  const folderName = isFolder
    ? (currentNode?.name ?? resourceId)
    : (pathSegments.length > 1 ? pathSegments[0] : null)
  const fileName = isFolder
    ? null
    : (pathSegments[pathSegments.length - 1] ?? currentNode?.name ?? resourceId)
  const iconType = !isFolder && currentNode
    ? getFileIconType(currentNode.name, currentNode.extension)
    : null

  const downloadUrl = downloadUrlData?.download_url || ''
  const displayFileName = fileName ?? currentNode?.name ?? resourceId
  const canOpenInEditor = Boolean(resourceId && !isFolder && typeof window !== 'undefined')

  const handleOpenInEditor = useCallback(() => {
    if (!canOpenInEditor)
      return
    const nextUrl = new URL(window.location.href)
    nextUrl.searchParams.set('view', 'skill')
    nextUrl.searchParams.set('fileId', resourceId)
    window.open(nextUrl.toString(), '_blank', 'noopener,noreferrer')
  }, [canOpenInEditor, resourceId])

  return (
    <div
      className={cn(
        'flex h-full w-[400px] max-w-[80vw] flex-col overflow-hidden rounded-2xl border-[0.5px] border-components-panel-border bg-components-panel-bg shadow-[0px_20px_24px_-4px_rgba(9,9,11,0.08),0px_8px_8px_-4px_rgba(9,9,11,0.03)]',
        className,
      )}
      style={style}
    >
      <div className="flex w-full items-center gap-2 px-4 pb-2 pt-4">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          {folderName && (
            <div className="flex items-center gap-1.5">
              <RiFolderLine className="size-5 text-text-secondary" aria-hidden="true" />
              <span className="text-[13px] font-medium leading-4 text-text-primary">
                {folderName}
              </span>
            </div>
          )}
          {folderName && fileName && (
            <span className="text-[13px] leading-4 text-text-tertiary">/</span>
          )}
          {fileName && (
            <div className="flex min-w-0 items-center gap-1.5">
              <FileTypeIcon
                type={(iconType || 'document') as FileAppearanceType}
                size="sm"
                className="!size-5"
              />
              <span className="truncate text-[13px] font-medium leading-4 text-text-primary">
                {fileName}
              </span>
            </div>
          )}
        </div>
        <Tooltip
          popupContent={t('skillEditor.openInSkillEditor', { ns: 'workflow' })}
          disabled={!canOpenInEditor}
        >
          <button
            type="button"
            onClick={handleOpenInEditor}
            disabled={!canOpenInEditor}
            className={cn(
              'inline-flex size-6 items-center justify-center rounded-md text-text-tertiary transition hover:bg-state-base-hover',
              !canOpenInEditor && 'cursor-not-allowed opacity-40 hover:bg-transparent',
            )}
            aria-label={t('skillEditor.openInSkillEditor', { ns: 'workflow' })}
          >
            <RiExternalLinkLine className="size-4" />
          </button>
        </Tooltip>
        <button
          type="button"
          onClick={onClose}
          className="inline-flex size-6 items-center justify-center rounded-md text-text-tertiary transition hover:bg-state-base-hover"
          aria-label={t('operation.close', { ns: 'common' })}
        >
          <RiCloseLine className="size-4" />
        </button>
      </div>
      <div className="flex min-h-0 w-full flex-1 gap-2 overflow-auto pb-4 pl-4 pr-3 pt-1">
        {isFolder && (
          <div className="text-text-tertiary system-sm-regular">
            {t('skillEditor.previewUnavailable')}
          </div>
        )}
        {isMarkdownPreview && isContentLoading && (
          <div className="flex w-full items-center justify-center py-6">
            <Loading type="area" />
          </div>
        )}
        {isMarkdownPreview && contentError && (
          <div className="text-text-tertiary system-sm-regular">
            {t('skillSidebar.loadError')}
          </div>
        )}
        {isMarkdownPreview && !isContentLoading && !contentError && (
          <SkillEditor
            value={content}
            editable={false}
            compact
            showLineNumbers
            className="text-[14px] leading-[22px] text-text-primary"
            placeholderClassName="hidden"
          />
        )}
        {isReadOnlyPreview && isDownloadLoading && (
          <div className="flex w-full items-center justify-center py-6">
            <Loading type="area" />
          </div>
        )}
        {isReadOnlyPreview && downloadError && (
          <div className="text-text-tertiary system-sm-regular">
            {t('skillSidebar.loadError')}
          </div>
        )}
        {isReadOnlyPreview && !isDownloadLoading && !downloadError && downloadUrl && (
          <ReadOnlyFilePreview
            downloadUrl={downloadUrl}
            fileName={displayFileName}
            extension={currentNode?.extension}
            fileSize={currentNode?.size ?? undefined}
          />
        )}
        {isReadOnlyPreview && !isDownloadLoading && !downloadError && !downloadUrl && (
          <div className="text-text-tertiary system-sm-regular">
            {t('skillSidebar.loadError')}
          </div>
        )}
      </div>
    </div>
  )
}

export default React.memo(FilePreviewPanel)
