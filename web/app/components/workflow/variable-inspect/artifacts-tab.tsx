import type { FC } from 'react'
import type { InspectHeaderProps } from './inspect-layout'
import type { SandboxFileTreeNode } from '@/types/sandbox-file'
import {
  RiCloseLine,
  RiDownloadLine,
  RiMenuLine,
} from '@remixicon/react'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import ActionButton from '@/app/components/base/action-button'
import CopyFeedback from '@/app/components/base/copy-feedback'
import Loading from '@/app/components/base/loading'
import ArtifactsTree from '@/app/components/workflow/skill/file-tree/artifacts-tree'
import { useAppContext } from '@/context/app-context'
import { useDownloadSandboxFile, useSandboxFilesTree } from '@/service/use-sandbox-file'
import { cn } from '@/utils/classnames'
import InspectLayout from './inspect-layout'
import SplitPanel from './split-panel'

const formatFileSize = (bytes: number | null): string => {
  if (bytes === null || bytes === 0)
    return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(1024))
  return `${(bytes / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${units[i]}`
}

const ArtifactsTab: FC<InspectHeaderProps> = (headerProps) => {
  const { t } = useTranslation('workflow')
  const { userProfile } = useAppContext()
  const sandboxId = userProfile?.id

  const { data: treeData, hasFiles, isLoading } = useSandboxFilesTree(sandboxId, {
    enabled: !!sandboxId,
  })
  const downloadMutation = useDownloadSandboxFile(sandboxId)

  const [selectedFile, setSelectedFile] = useState<SandboxFileTreeNode | null>(null)

  const handleFileSelect = useCallback((node: SandboxFileTreeNode) => {
    if (node.node_type === 'file')
      setSelectedFile(node)
  }, [])

  const { mutateAsync: downloadFile } = downloadMutation
  const handleDownload = useCallback(async (node: SandboxFileTreeNode) => {
    try {
      const ticket = await downloadFile(node.path)
      window.open(ticket.download_url, '_blank')
    }
    catch (error) {
      console.error('Download failed:', error)
    }
  }, [downloadFile])

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
        <div className="flex h-full items-center justify-center p-2">
          <div className="rounded-lg bg-background-section p-3">
            <p className="system-xs-regular text-text-tertiary">
              {t('skillSidebar.artifacts.emptyState')}
            </p>
          </div>
        </div>
      </InspectLayout>
    )
  }

  const file = selectedFile

  return (
    <SplitPanel
      {...headerProps}
      left={(
        <div className="h-full overflow-y-auto py-1">
          <ArtifactsTree
            data={treeData}
            onDownload={handleDownload}
            onSelect={handleFileSelect}
            selectedPath={selectedFile?.path}
            isDownloading={downloadMutation.isPending}
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
                  <RiMenuLine className="h-4 w-4" />
                </ActionButton>
              )}
              {file && (
                <>
                  <div className="flex w-0 grow items-center gap-1">
                    <div className="flex items-center gap-1 truncate">
                      {file.path.split('/').map((part, i, arr) => (
                        <span key={i} className="flex items-center gap-1">
                          {i > 0 && <span className="system-sm-regular text-text-quaternary">/</span>}
                          <span
                            className={cn(
                              'system-sm-semibold truncate',
                              i === arr.length - 1 ? 'text-text-secondary' : 'text-text-tertiary',
                            )}
                          >
                            {part}
                          </span>
                        </span>
                      ))}
                    </div>
                    <span className="system-xs-medium shrink-0 text-text-tertiary">
                      {formatFileSize(file.size)}
                    </span>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <CopyFeedback content={file.path} />
                    <ActionButton
                      onClick={() => handleDownload(file)}
                      disabled={downloadMutation.isPending}
                      aria-label={`Download ${file.name}`}
                    >
                      <RiDownloadLine className="h-4 w-4" />
                    </ActionButton>
                  </div>
                </>
              )}
            </div>
            <ActionButton className="shrink-0" onClick={handleClose} aria-label="Close">
              <RiCloseLine className="h-4 w-4" />
            </ActionButton>
          </div>
          <div className="flex min-h-0 flex-1 flex-col">
            {file
              ? (
                  <div className="grow overflow-auto p-2">
                    <div className="flex h-full items-center justify-center rounded-xl bg-background-section">
                      <p className="system-xs-regular text-text-tertiary">
                        {t('debug.variableInspect.tabArtifacts.previewNotAvailable')}
                      </p>
                    </div>
                  </div>
                )
              : (
                  <div className="flex h-full items-center justify-center p-2">
                    <p className="system-xs-regular text-text-tertiary">
                      {t('debug.variableInspect.tabArtifacts.selectFile')}
                    </p>
                  </div>
                )}
          </div>
        </>
      )}
    </SplitPanel>
  )
}

export default ArtifactsTab
