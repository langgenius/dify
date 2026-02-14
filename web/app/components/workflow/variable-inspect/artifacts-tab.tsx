import type { InspectHeaderProps } from './inspect-layout'
import type { DocPathWithoutLang } from '@/types/doc-paths'
import type { SandboxFileTreeNode } from '@/types/sandbox-file'
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import ActionButton from '@/app/components/base/action-button'
import SearchLinesSparkle from '@/app/components/base/icons/src/vender/knowledge/SearchLinesSparkle'
import { FileDownload01 } from '@/app/components/base/icons/src/vender/line/files'
import Loading from '@/app/components/base/loading'
import ArtifactsTree from '@/app/components/workflow/skill/file-tree/artifacts/artifacts-tree'
import ReadOnlyFilePreview from '@/app/components/workflow/skill/viewer/read-only-file-preview'
import { useDocLink } from '@/context/i18n'
import { useDownloadSandboxFile, useSandboxFileDownloadUrl, useSandboxFilesTree } from '@/service/use-sandbox-file'
import { cn } from '@/utils/classnames'
import { downloadUrl } from '@/utils/download'
import { useStore } from '../store'
import { WorkflowRunningStatus } from '../types'
import InspectLayout from './inspect-layout'
import SplitPanel from './split-panel'

const fileSystemArtifactsLocalizedPathMap = {
  'zh-Hans': '/use-dify/build/file-system#产物' as DocPathWithoutLang,
  'zh_Hans': '/use-dify/build/file-system#产物' as DocPathWithoutLang,
  'ja-JP': '/use-dify/build/file-system#アーティファクト' as DocPathWithoutLang,
  'ja_JP': '/use-dify/build/file-system#アーティファクト' as DocPathWithoutLang,
}

const ArtifactsEmpty = ({ description }: { description: string }) => {
  const { t } = useTranslation('workflow')
  const docLink = useDocLink()

  return (
    <div className="flex h-full flex-col gap-3 rounded-xl bg-background-section p-8">
      <div className="flex h-10 w-10 items-center justify-center rounded-[10px] border-[0.5px] border-components-card-border bg-components-card-bg shadow-lg backdrop-blur-sm">
        <SearchLinesSparkle className="h-5 w-5 text-text-accent" aria-hidden="true" />
      </div>
      <div className="flex flex-col gap-1">
        <div className="text-text-secondary system-sm-semibold">{t('debug.variableInspect.tabArtifacts.emptyTitle')}</div>
        <div className="text-text-tertiary system-xs-regular">{description}</div>
        <a
          className="cursor-pointer text-text-accent system-xs-regular"
          href={docLink('/use-dify/build/file-system#artifacts' as DocPathWithoutLang, fileSystemArtifactsLocalizedPathMap)}
          target="_blank"
          rel="noopener noreferrer"
        >
          {t('debug.variableInspect.tabArtifacts.emptyLink')}
        </a>
      </div>
    </div>
  )
}

const formatFileSize = (bytes: number | null): string => {
  if (bytes === null || bytes === 0)
    return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(1024))
  return `${(bytes / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${units[i]}`
}

const ArtifactsTab = (headerProps: InspectHeaderProps) => {
  const { t } = useTranslation('workflow')
  const appId = useStore(s => s.appId)
  const isWorkflowRunning = useStore(
    s => s.workflowRunningData?.result?.status === WorkflowRunningStatus.Running,
  )
  const isResponding = useStore(s => s.isResponding)

  const { data: treeData, flatData, hasFiles, isLoading } = useSandboxFilesTree(appId, {
    enabled: !!appId,
    refetchInterval: (isWorkflowRunning || isResponding) ? 5000 : false,
  })
  const { mutateAsync: fetchDownloadUrl, isPending: isDownloading } = useDownloadSandboxFile(appId)
  const [selectedFile, setSelectedFile] = useState<SandboxFileTreeNode | null>(null)
  const selectedFilePath = useMemo(() => {
    if (!selectedFile)
      return undefined

    const selectedExists = flatData?.some(
      node => !node.is_dir && node.path === selectedFile.path,
    ) ?? false

    return selectedExists ? selectedFile.path : undefined
  }, [flatData, selectedFile])

  const { data: downloadUrlData, isLoading: isDownloadUrlLoading } = useSandboxFileDownloadUrl(
    appId,
    selectedFilePath,
    { retry: false },
  )

  const handleFileSelect = useCallback((node: SandboxFileTreeNode) => {
    if (node.node_type === 'file')
      setSelectedFile(node)
  }, [])

  const handleTreeDownload = useCallback(async (node: SandboxFileTreeNode) => {
    try {
      const ticket = await fetchDownloadUrl(node.path)
      downloadUrl({ url: ticket.download_url, fileName: node.name })
    }
    catch (error) {
      console.error('Download failed:', error)
    }
  }, [fetchDownloadUrl])

  const handleSelectedFileDownload = useCallback(() => {
    if (downloadUrlData?.download_url && selectedFile)
      downloadUrl({ url: downloadUrlData.download_url, fileName: selectedFile.name })
  }, [downloadUrlData, selectedFile])

  if (isLoading) {
    return (
      <InspectLayout {...headerProps}>
        <div className="flex h-full items-center justify-center">
          <Loading />
        </div>
      </InspectLayout>
    )
  }

  if (!hasFiles) {
    return (
      <InspectLayout {...headerProps}>
        <div className="h-full p-2">
          <ArtifactsEmpty description={t('debug.variableInspect.tabArtifacts.emptyTip')} />
        </div>
      </InspectLayout>
    )
  }

  const file = selectedFilePath ? selectedFile : null
  const parts = file?.path.split('/') ?? []
  let cumPath = ''
  const pathSegments = parts.map((part, i) => {
    cumPath += (cumPath ? '/' : '') + part
    return { part, key: cumPath, isFirst: i === 0, isLast: i === parts.length - 1 }
  })

  return (
    <SplitPanel
      {...headerProps}
      left={(
        <div className="h-full overflow-y-auto py-1">
          <ArtifactsTree
            data={treeData}
            onDownload={handleTreeDownload}
            onSelect={handleFileSelect}
            selectedPath={selectedFilePath}
            isDownloading={isDownloading}
          />
        </div>
      )}
    >
      {({ isNarrow, onOpenMenu, onClose: handleClose }) => (
        <>
          <div className="flex shrink-0 items-center justify-between gap-1 px-2 pt-2">
            <div className="flex min-w-0 flex-1 items-center gap-1">
              {isNarrow && (
                <ActionButton className="shrink-0" onClick={onOpenMenu} aria-label="Open menu">
                  <span className="i-ri-menu-line h-4 w-4" aria-hidden="true" />
                </ActionButton>
              )}
              {file && (
                <>
                  <div className="flex w-0 grow items-center gap-1">
                    <div className="flex items-center gap-1 truncate">
                      {pathSegments!.map(seg => (
                        <span key={seg.key} className="flex items-center gap-1">
                          {!seg.isFirst && <span className="text-text-quaternary system-sm-regular">/</span>}
                          <span
                            className={cn(
                              'truncate system-sm-semibold',
                              seg.isLast ? 'text-text-secondary' : 'text-text-tertiary',
                            )}
                          >
                            {seg.part}
                          </span>
                        </span>
                      ))}
                    </div>
                    <span className="shrink-0 text-text-tertiary system-xs-medium">
                      {formatFileSize(file.size)}
                    </span>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <ActionButton
                      onClick={handleSelectedFileDownload}
                      disabled={!downloadUrlData?.download_url}
                      aria-label={`Download ${file.name}`}
                    >
                      <FileDownload01 className="h-4 w-4" />
                    </ActionButton>
                  </div>
                </>
              )}
            </div>
            <ActionButton className="shrink-0" onClick={handleClose} aria-label="Close">
              <span className="i-ri-close-line h-4 w-4" aria-hidden="true" />
            </ActionButton>
          </div>
          <div className="flex min-h-0 flex-1 flex-col">
            {file
              ? (
                  <div className="min-h-0 grow">
                    {isDownloadUrlLoading
                      ? <div className="flex h-full items-center justify-center"><Loading type="area" /></div>
                      : downloadUrlData?.download_url
                        ? (
                            <ReadOnlyFilePreview
                              downloadUrl={downloadUrlData.download_url}
                              fileName={file.name}
                              extension={file.extension}
                              fileSize={file.size}
                            />
                          )
                        : (
                            <div className="flex h-full items-center justify-center rounded-xl bg-background-section">
                              <p className="text-text-tertiary system-xs-regular">
                                {t('debug.variableInspect.tabArtifacts.previewNotAvailable')}
                              </p>
                            </div>
                          )}
                  </div>
                )
              : (
                  <div className="grow p-2">
                    <ArtifactsEmpty description={t('debug.variableInspect.tabArtifacts.selectFile')} />
                  </div>
                )}
          </div>
        </>
      )}
    </SplitPanel>
  )
}

export default ArtifactsTab
