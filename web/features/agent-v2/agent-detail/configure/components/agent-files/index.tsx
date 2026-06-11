'use client'

import type { FileTreeIconType } from '@langgenius/dify-ui/file-tree'
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
import { ConfigureSection } from '../configure-section'
import { defaultAgentFiles } from '../configured-data'

export type AgentFileNode = {
  id: string
  name: string
  icon: FileTreeIconType
  children?: AgentFileNode[]
}

function AgentFileRows({
  files,
}: {
  files: AgentFileNode[]
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
            <AgentFileRows files={file.children} />
          </FileTreeFolderPanel>
        </FileTreeFolder>
      )
    }

    return (
      <FileTreeFile key={file.id}>
        <FileTreeIcon type={file.icon} />
        <FileTreeLabel>{file.name}</FileTreeLabel>
      </FileTreeFile>
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
          <AgentFileRows files={files} />
        </FileTreeList>
      </FileTreeRoot>
    </ConfigureSection>
  )
}
