'use client'

import type { AgentSkillDetail } from '../agent-skills/agent-skill-detail-dialog'
import type { AgentFileNode } from '../configured-data'
import { Dialog, DialogTrigger } from '@langgenius/dify-ui/dialog'
import {
  FileTreeFile,
  FileTreeFolder,
  FileTreeFolderPanel,
  FileTreeFolderTrigger,
  FileTreeIcon,
  FileTreeLabel,
  FileTreeList,
  FileTreeRoot,
} from '@langgenius/dify-ui/file-tree'
import { useTranslation } from 'react-i18next'
import { AgentSkillDetailDialog } from '../agent-skills/agent-skill-detail-dialog'
import { ConfigureSection } from '../configure-section'
import { defaultAgentFiles } from '../configured-data'

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

function AgentFileRows({
  files,
  rootFiles,
}: {
  files: AgentFileNode[]
  rootFiles: AgentFileNode[]
}) {
  return files.map((file) => {
    if (file.children?.length) {
      return (
        <FileTreeFolder key={file.id} defaultOpen>
          <FileTreeFolderTrigger>
            <FileTreeIcon type="folder" />
            <FileTreeLabel>{file.name}</FileTreeLabel>
          </FileTreeFolderTrigger>
          <FileTreeFolderPanel>
            <AgentFileRows files={file.children} rootFiles={rootFiles} />
          </FileTreeFolderPanel>
        </FileTreeFolder>
      )
    }

    return (
      <Dialog key={file.id}>
        <DialogTrigger render={<FileTreeFile />}>
          <FileTreeIcon type={file.icon} />
          <FileTreeLabel title={file.name}>{file.name}</FileTreeLabel>
        </DialogTrigger>
        <AgentSkillDetailDialog skillName={file.name} detail={createFileDetail(file, rootFiles)} />
      </Dialog>
    )
  })
}

export function AgentFiles({
  files = defaultAgentFiles,
}: {
  files?: AgentFileNode[]
}) {
  const { t } = useTranslation('agentV2')
  const filesTip = t('agentDetail.configure.files.tip')
  const filesTreeId = 'agent-configure-files-tree'

  return (
    <ConfigureSection
      label={t('agentDetail.configure.files.label')}
      labelId="agent-configure-files-label"
      tip={filesTip}
      tipAriaLabel={filesTip}
      rootClassName="border-b border-divider-subtle pt-4"
      panelContentClassName="pb-4"
      actions={(
        <button
          type="button"
          aria-label={t('agentDetail.configure.files.add')}
          className="flex size-6 shrink-0 items-center justify-center rounded-md text-text-tertiary hover:bg-state-base-hover hover:text-text-secondary focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden"
        >
          <span aria-hidden className="i-ri-add-line size-4" />
        </button>
      )}
    >
      <FileTreeRoot
        id={filesTreeId}
        aria-label={t('agentDetail.configure.files.treeLabel')}
        className="rounded-lg border-[0.5px] border-components-panel-border bg-components-panel-on-panel-item-bg shadow-xs shadow-shadow-shadow-3"
      >
        <FileTreeList>
          <AgentFileRows files={files} rootFiles={files} />
        </FileTreeList>
      </FileTreeRoot>
    </ConfigureSection>
  )
}
