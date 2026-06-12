'use client'

import type { ReactNode } from 'react'
import type { AgentFileNode } from '../../data'
import type { AgentSkillDetail } from '../skills/detail-dialog'
import { Dialog, DialogTrigger } from '@langgenius/dify-ui/dialog'
import {
  FileTreeGuide,
} from '@langgenius/dify-ui/file-tree'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useFiles } from '@/features/agent-v2/agent-composer/store'
import { ConfigureSectionAddButton } from '../common/add-button'
import { ConfigureSectionEmpty } from '../common/empty'
import { ConfigureSection } from '../common/section'
import { AgentSkillDetailDialog } from '../skills/detail-dialog'
import { AgentFileTree } from './tree'
import { AgentFileUploadDialog } from './upload-dialog'

function createFileDetail(file: AgentFileNode, files: AgentFileNode[]): AgentSkillDetail {
  return {
    description: 'This file is part of the current agent file tree and can be inspected alongside the same project structure shown in the configure panel.',
    files,
    selectedFileId: file.id,
    sections: [
      {
        id: 'overview',
        title: 'Overview',
        paragraphs: [
          'Use this dialog to review the selected file in context without losing the surrounding agent configuration. The file tree on the right mirrors the current configure file list, so expanded folders and long names keep the same visual contract.',
          'Mock content is intentionally longer here to exercise the inside-scroll layout, text wrapping, and fixed-width file tree behavior before real file content is connected.',
        ],
      },
      {
        id: 'usage',
        title: 'Usage Notes',
        items: [
          'Keep file names truncated in the tree instead of widening the right panel.',
          'Highlight the opened file through FileTree selected state so the visual treatment stays CSS-driven.',
          'Reserve vertical scrolling for the dialog content area and the file tree viewport only.',
        ],
      },
    ],
  }
}

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
  files,
  onRemove,
  selected,
}: {
  children: ReactNode
  depth: number
  file: AgentFileNode
  files: AgentFileNode[]
  onRemove: (fileId: string) => void
  selected: boolean
}) {
  const { t } = useTranslation('agentV2')

  return (
    <Dialog>
      <li className="group/file-row relative min-w-0">
        <DialogTrigger
          render={(
            <button
              type="button"
              data-selected={selected || undefined}
              aria-current={selected ? 'true' : undefined}
              className="group/file-tree-row relative flex h-6 w-full min-w-0 cursor-pointer items-center rounded-md pr-7 pl-2 text-left outline-hidden select-none hover:bg-state-base-hover focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:ring-inset data-[selected]:bg-state-base-active"
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
        <button
          type="button"
          data-agent-file-remove-button
          aria-label={t('agentDetail.configure.files.remove', { name: file.name })}
          onClick={() => onRemove(file.id)}
          className="pointer-events-none absolute top-1/2 right-1 z-10 flex size-5 -translate-y-1/2 items-center justify-center rounded-md text-text-tertiary opacity-0 group-focus-within/file-row:pointer-events-auto group-focus-within/file-row:opacity-100 group-hover/file-row:pointer-events-auto group-hover/file-row:opacity-100 hover:bg-state-destructive-hover hover:text-text-destructive focus-visible:bg-state-destructive-hover focus-visible:text-text-destructive focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden"
        >
          <span aria-hidden className="i-ri-delete-bin-line size-4" />
        </button>
      </li>
      <AgentSkillDetailDialog skillName={file.name} detail={createFileDetail(file, files)} />
    </Dialog>
  )
}

export function AgentFiles() {
  const { t } = useTranslation('agentV2')
  const [files, setFiles] = useFiles()
  const filesTip = t('agentDetail.configure.files.tip')
  const filesTreeId = 'agent-configure-files-tree'
  const [isUploadOpen, setIsUploadOpen] = useState(false)
  const removeFile = (fileId: string) => setFiles(removeFileNode(files, fileId))

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
            onClick={() => setIsUploadOpen(true)}
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
                    files={files}
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
        onUploaded={file => setFiles([...files, file])}
      />
    </>
  )
}
