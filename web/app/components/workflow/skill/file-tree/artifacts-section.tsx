'use client'

import type { SandboxFileTreeNode } from '@/types/sandbox-file'
import { RiArrowDownSLine, RiArrowRightSLine, RiLoader2Line } from '@remixicon/react'
import * as React from 'react'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import FolderSpark from '@/app/components/base/icons/src/vender/workflow/FolderSpark'
import { useStore, useWorkflowStore } from '@/app/components/workflow/store'
import { useAppContext } from '@/context/app-context'
import { useDownloadSandboxFile, useSandboxFilesTree } from '@/service/use-sandbox-file'
import { cn } from '@/utils/classnames'
import { downloadUrl } from '@/utils/download'
import ArtifactsTree from './artifacts-tree'

type ArtifactsSectionProps = {
  className?: string
}

const ArtifactsSection = ({ className }: ArtifactsSectionProps) => {
  const { t } = useTranslation('workflow')
  const { userProfile } = useAppContext()
  const sandboxId = userProfile?.id

  const [isExpanded, setIsExpanded] = useState(false)

  const { data: treeData, hasFiles, isLoading } = useSandboxFilesTree(sandboxId)

  const { mutateAsync: fetchDownloadUrl, isPending: isDownloading } = useDownloadSandboxFile(sandboxId)
  const storeApi = useWorkflowStore()
  const selectedArtifactPath = useStore(s => s.selectedArtifactPath)

  const handleToggle = useCallback(() => {
    setIsExpanded(prev => !prev)
  }, [])

  const handleSelect = useCallback((node: SandboxFileTreeNode) => {
    storeApi.getState().selectArtifact(node.path)
  }, [storeApi])

  const handleDownload = useCallback(async (node: SandboxFileTreeNode) => {
    try {
      const ticket = await fetchDownloadUrl(node.path)
      downloadUrl({ url: ticket.download_url, fileName: node.name })
    }
    catch (error) {
      console.error('Download failed:', error)
    }
  }, [fetchDownloadUrl])

  const showBlueDot = !isExpanded && hasFiles
  const showSpinner = isLoading

  return (
    <div className={cn('flex max-h-[40%] flex-col border-t border-divider-regular', className)}>
      <div className="shrink-0 p-1">
        <button
          type="button"
          onClick={handleToggle}
          className={cn(
            'flex w-full items-center rounded-md py-1 pl-2 pr-1.5',
            'hover:bg-state-base-hover',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-components-input-border-active',
          )}
          aria-expanded={isExpanded}
          aria-label={t('skillSidebar.artifacts.openArtifacts')}
        >
          <div className="flex flex-1 items-center gap-1 py-0.5">
            <div className="flex size-5 items-center justify-center">
              <FolderSpark className="size-4 text-text-secondary" aria-hidden="true" />
            </div>
            <span className="system-sm-semibold uppercase text-text-secondary">
              {t('skillSidebar.artifacts.title')}
            </span>
          </div>

          <div className="relative flex items-center">
            {showSpinner
              ? <RiLoader2Line className="size-3.5 animate-spin text-text-tertiary" aria-hidden="true" />
              : (
                  <>
                    {showBlueDot && (
                      <div className="absolute -left-2 size-[7px] rounded-full border border-white bg-state-accent-solid" />
                    )}
                    {isExpanded
                      ? <RiArrowDownSLine className="size-4 text-text-tertiary" aria-hidden="true" />
                      : <RiArrowRightSLine className="size-4 text-text-tertiary" aria-hidden="true" />}
                  </>
                )}
          </div>
        </button>
      </div>

      {isExpanded && !isLoading && (
        <div className="min-h-0 flex-1 overflow-y-auto px-1 pb-1">
          {hasFiles
            ? (
                <ArtifactsTree
                  data={treeData}
                  onDownload={handleDownload}
                  onSelect={handleSelect}
                  selectedPath={selectedArtifactPath ?? undefined}
                  isDownloading={isDownloading}
                />
              )
            : (
                <div className="px-1.5 pb-0.5">
                  <div className="rounded-lg bg-background-section p-3">
                    <p className="system-xs-regular text-text-tertiary">
                      {t('skillSidebar.artifacts.emptyState')}
                    </p>
                  </div>
                </div>
              )}
        </div>
      )}
    </div>
  )
}

export default React.memo(ArtifactsSection)
