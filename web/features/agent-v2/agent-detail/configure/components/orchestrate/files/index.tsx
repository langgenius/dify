'use client'

import type { ReactNode } from 'react'
import type { AgentFileNode } from '../../data'
import {
  FileTreeGuide,
} from '@langgenius/dify-ui/file-tree'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useFiles } from '@/features/agent-v2/agent-composer/store'
import { ConfigureSectionAddButton } from '../common/add-button'
import { ConfigureSectionEmpty } from '../common/empty'
import { ConfigureSection } from '../common/section'
import { AgentFileTree } from './tree'
import { AgentFileUploadDialog } from './upload-dialog'

const removeFileNode = (files: AgentFileNode[], fileId: string): AgentFileNode[] => files
  .filter(file => file.id !== fileId)
  .map(file => ({
    ...file,
    children: file.children ? removeFileNode(file.children, fileId) : undefined,
  }))

function AgentFileItem({
  children,
  depth,
  file,
  onRemove,
  selected,
}: {
  children: ReactNode
  depth: number
  file: AgentFileNode
  onRemove: (fileId: string) => void
  selected: boolean
}) {
  const { t } = useTranslation('agentV2')
  const handleRemove = useCallback(() => {
    onRemove(file.id)
  }, [file.id, onRemove])

  return (
    <li className="group/file-row relative min-w-0">
      <div
        data-selected={selected || undefined}
        aria-current={selected ? 'true' : undefined}
        className="group/file-tree-row relative flex h-6 w-full min-w-0 items-center rounded-md pr-7 pl-2 text-left outline-hidden select-none hover:bg-state-base-hover data-[selected]:bg-state-base-active"
      >
        {Array.from({ length: Math.max(depth - 1, 0) }, (_, index) => (
          <FileTreeGuide key={index} />
        ))}
        <div className="flex min-w-0 flex-[1_0_0] items-center py-0.5">
          {children}
        </div>
      </div>
      <button
        type="button"
        data-agent-file-remove-button
        aria-label={t('agentDetail.configure.files.remove', { name: file.name })}
        onClick={handleRemove}
        className="pointer-events-none absolute top-1/2 right-1 z-10 flex size-5 -translate-y-1/2 items-center justify-center rounded-md text-text-tertiary opacity-0 group-focus-within/file-row:pointer-events-auto group-focus-within/file-row:opacity-100 group-hover/file-row:pointer-events-auto group-hover/file-row:opacity-100 hover:bg-state-destructive-hover hover:text-text-destructive focus-visible:bg-state-destructive-hover focus-visible:text-text-destructive focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden"
      >
        <span aria-hidden className="i-ri-delete-bin-line size-4" />
      </button>
    </li>
  )
}

export function AgentFiles() {
  const { t } = useTranslation('agentV2')
  const [files, setFiles] = useFiles()
  const filesTip = t('agentDetail.configure.files.tip')
  const filesTreeId = 'agent-configure-files-tree'
  const [isUploadOpen, setIsUploadOpen] = useState(false)
  const removeFile = useCallback((fileId: string) => {
    setFiles(removeFileNode(files, fileId))
  }, [files, setFiles])
  const handleOpenUpload = useCallback(() => {
    setIsUploadOpen(true)
  }, [])
  const handleUploaded = useCallback((file: AgentFileNode) => {
    setFiles([...files, file])
  }, [files, setFiles])

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
            onClick={handleOpenUpload}
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
        open={isUploadOpen}
        onOpenChange={setIsUploadOpen}
        onUploaded={handleUploaded}
      />
    </>
  )
}
