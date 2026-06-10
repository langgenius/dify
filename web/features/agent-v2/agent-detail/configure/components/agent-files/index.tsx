'use client'

import type { FileTreeIconType } from '@langgenius/dify-ui/file-tree'
import { cn } from '@langgenius/dify-ui/cn'
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
import { Tooltip, TooltipContent, TooltipTrigger } from '@langgenius/dify-ui/tooltip'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

export type AgentFileNode = {
  id: string
  name: string
  icon: FileTreeIconType
  children?: AgentFileNode[]
}

const defaultFiles: AgentFileNode[] = [
  {
    id: 'index-json',
    name: '_index.json',
    icon: 'json',
  },
  {
    id: 'web-game',
    name: 'web-game',
    icon: 'folder',
    children: [
      {
        id: 'web-game-public',
        name: 'public',
        icon: 'folder',
      },
      {
        id: 'web-game-assets',
        name: 'assets',
        icon: 'folder',
      },
      {
        id: 'web-game-src',
        name: 'src',
        icon: 'folder',
      },
      {
        id: 'web-game-styles',
        name: 'styles',
        icon: 'folder',
      },
      {
        id: 'web-game-readme',
        name: 'README.md',
        icon: 'markdown',
      },
    ],
  },
]

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
  files = defaultFiles,
}: {
  files?: AgentFileNode[]
}) {
  const { t } = useTranslation('agentV2')
  const [isExpanded, setIsExpanded] = useState(true)
  const filesTip = t('agentDetail.configure.files.tip')
  const filesTreeId = 'agent-configure-files-tree'

  return (
    <section className={cn('border-b border-divider-subtle pt-4', isExpanded && 'pb-4')} aria-labelledby="agent-configure-files-label">
      <div className="mb-2 flex min-h-6 items-center gap-2">
        <div className="flex min-w-0 flex-1 items-center gap-0.5">
          <h3
            id="agent-configure-files-label"
            className="truncate system-sm-semibold-uppercase text-text-secondary"
          >
            {t('agentDetail.configure.files.label')}
          </h3>
          <Tooltip>
            <TooltipTrigger
              render={(
                <button
                  type="button"
                  aria-label={filesTip}
                  className="flex size-4 shrink-0 items-center justify-center rounded-sm text-text-quaternary hover:text-text-tertiary focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden"
                >
                  <span aria-hidden className="i-ri-question-line size-3.5" />
                </button>
              )}
            />
            <TooltipContent placement="top" className="max-w-64">
              {filesTip}
            </TooltipContent>
          </Tooltip>
          <button
            type="button"
            aria-label={t('agentDetail.configure.files.toggle')}
            aria-controls={filesTreeId}
            aria-expanded={isExpanded}
            onClick={() => setIsExpanded(expanded => !expanded)}
            className="flex size-4 shrink-0 items-center justify-center rounded-sm text-text-quaternary hover:text-text-tertiary focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden"
          >
            <span
              aria-hidden
              className={`i-custom-vender-solid-arrows-arrow-down-round-fill size-4 transition-transform ${isExpanded ? '' : '-rotate-90'}`}
            />
          </button>
        </div>

        <button
          type="button"
          aria-label={t('agentDetail.configure.files.add')}
          className="flex size-6 shrink-0 items-center justify-center rounded-md text-text-tertiary hover:bg-state-base-hover hover:text-text-secondary focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden"
        >
          <span aria-hidden className="i-ri-add-line size-4" />
        </button>
      </div>

      {isExpanded && (
        <FileTreeRoot
          aria-label={t('agentDetail.configure.files.treeLabel')}
          className="rounded-lg border-[0.5px] border-components-panel-border bg-components-panel-on-panel-item-bg shadow-xs shadow-shadow-shadow-3"
        >
          <FileTreeList>
            <AgentFileRows files={files} />
          </FileTreeList>
        </FileTreeRoot>
      )}
    </section>
  )
}
