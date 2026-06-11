'use client'

import type { AgentFileNode } from '../data'
import type { AgentSkillDetail } from '../skills/detail-dialog'
import { Dialog, DialogTrigger } from '@langgenius/dify-ui/dialog'
import {
  FileTreeFile,
} from '@langgenius/dify-ui/file-tree'
import { useTranslation } from 'react-i18next'
import { useAgentConfigureFiles } from '../../../atoms'
import { ConfigureSectionAddButton } from '../add-button'
import { AgentFileTree } from '../file-tree'
import { ConfigureSection } from '../section'
import { AgentSkillDetailDialog } from '../skills/detail-dialog'

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

export function AgentFiles() {
  const { t } = useTranslation('agentV2')
  const [files] = useAgentConfigureFiles()
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
        <ConfigureSectionAddButton ariaLabel={t('agentDetail.configure.files.add')} />
      )}
    >
      <AgentFileTree
        id={filesTreeId}
        files={files}
        treeLabel={t('agentDetail.configure.files.treeLabel')}
        className="rounded-lg border-[0.5px] border-components-panel-border bg-components-panel-on-panel-item-bg p-1 shadow-xs shadow-shadow-shadow-3"
        scrollAreaClassName="max-h-[250px] flex-none"
        renderFile={({ file, selected, children }) => (
          <Dialog>
            <DialogTrigger render={<FileTreeFile selected={selected} />}>
              {children}
            </DialogTrigger>
            <AgentSkillDetailDialog skillName={file.name} detail={createFileDetail(file, files)} />
          </Dialog>
        )}
      />
    </ConfigureSection>
  )
}
