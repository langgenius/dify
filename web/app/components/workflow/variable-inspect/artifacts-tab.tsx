import type { FC } from 'react'
import type { SandboxFileTreeNode } from '@/types/sandbox-file'
import {
  RiDownloadLine,
  RiMenuLine,
} from '@remixicon/react'
import { memo, useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import ActionButton from '@/app/components/base/action-button'
import CopyFeedback from '@/app/components/base/copy-feedback'
import Loading from '@/app/components/base/loading'
import ArtifactsTree from '@/app/components/workflow/skill/file-tree/artifacts-tree'
import { useAppContext } from '@/context/app-context'
import { useDownloadSandboxFile, useSandboxFilesTree } from '@/service/use-sandbox-file'
import { cn } from '@/utils/classnames'
import { useStore } from '../store'

const formatFileSize = (bytes: number | null): string => {
  if (bytes === null || bytes === 0)
    return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(1024))
  return `${(bytes / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${units[i]}`
}

type ArtifactsPreviewPaneProps = {
  file: SandboxFileTreeNode | null
  onDownload: (node: SandboxFileTreeNode) => void
  isDownloading: boolean
  onOpenMenu: () => void
}

const ArtifactsPreviewPane = memo<ArtifactsPreviewPaneProps>(({
  file,
  onDownload,
  isDownloading,
  onOpenMenu,
}) => {
  const { t } = useTranslation('workflow')
  const bottomPanelWidth = useStore(s => s.bottomPanelWidth)

  if (!file) {
    return (
      <div className="flex h-full items-center justify-center p-2">
        <p className="system-xs-regular text-text-tertiary">
          {t('debug.variableInspect.tabArtifacts.selectFile')}
        </p>
      </div>
    )
  }

  const pathParts = file.path.split('/')

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center justify-between gap-1 px-2 pt-2">
        {bottomPanelWidth < 488 && (
          <ActionButton className="shrink-0" onClick={onOpenMenu} aria-label="Open menu">
            <RiMenuLine className="h-4 w-4" />
          </ActionButton>
        )}
        <div className="flex w-0 grow items-center gap-1">
          <div className="flex items-center gap-1 truncate">
            {pathParts.map((part, i) => (
              <span key={i} className="flex items-center gap-1">
                {i > 0 && <span className="system-sm-regular text-text-quaternary">/</span>}
                <span className={cn(
                  'system-sm-semibold truncate',
                  i === pathParts.length - 1 ? 'text-text-secondary' : 'text-text-tertiary',
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
            onClick={() => onDownload(file)}
            disabled={isDownloading}
            aria-label={`Download ${file.name}`}
          >
            <RiDownloadLine className="h-4 w-4" />
          </ActionButton>
        </div>
      </div>
      <div className="grow overflow-auto p-2">
        <div className="flex h-full items-center justify-center rounded-xl bg-background-section">
          <p className="system-xs-regular text-text-tertiary">
            {t('debug.variableInspect.tabArtifacts.previewNotAvailable')}
          </p>
        </div>
      </div>
    </div>
  )
})

const ArtifactsTab: FC = () => {
  const { t } = useTranslation()
  const { userProfile } = useAppContext()
  const sandboxId = userProfile?.id
  const bottomPanelWidth = useStore(s => s.bottomPanelWidth)

  const { data: treeData, hasFiles, isLoading } = useSandboxFilesTree(sandboxId, {
    enabled: !!sandboxId,
  })
  const downloadMutation = useDownloadSandboxFile(sandboxId)

  const [selectedFile, setSelectedFile] = useState<SandboxFileTreeNode | null>(null)
  const [showLeftPanel, setShowLeftPanel] = useState(true)

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
      <div className="flex h-full items-center justify-center">
        <Loading />
      </div>
    )
  }

  if (!hasFiles) {
    return (
      <div className="flex h-full items-center justify-center p-2">
        <div className="rounded-lg bg-background-section p-3">
          <p className="system-xs-regular text-text-tertiary">
            {t('skillSidebar.artifacts.emptyState', { ns: 'workflow' })}
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className={cn('relative flex h-full')}>
      {bottomPanelWidth < 488 && showLeftPanel && (
        <div role="presentation" className="absolute left-0 top-0 h-full w-full" onClick={() => setShowLeftPanel(false)} />
      )}
      <div
        className={cn(
          'flex w-60 shrink-0 flex-col border-r border-divider-burn',
          bottomPanelWidth < 488
            ? showLeftPanel
              ? 'absolute left-0 top-0 z-10 h-full w-[217px] rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-bg shadow-lg backdrop-blur-sm'
              : 'hidden'
            : '',
        )}
      >
        <div className="min-h-0 flex-1 overflow-y-auto py-1">
          <ArtifactsTree
            data={treeData}
            onDownload={handleDownload}
            onSelect={handleFileSelect}
            selectedPath={selectedFile?.path}
            isDownloading={downloadMutation.isPending}
          />
        </div>
      </div>
      <div className="w-0 grow">
        <ArtifactsPreviewPane
          file={selectedFile}
          onDownload={handleDownload}
          isDownloading={downloadMutation.isPending}
          onOpenMenu={() => setShowLeftPanel(true)}
        />
      </div>
    </div>
  )
}

export default ArtifactsTab
