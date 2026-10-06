'use client'

import type { ReactNode } from 'react'
import type { AgentFileNode } from '@/features/agent-v2/agent-composer/form-state'
import { cn } from '@langgenius/dify-ui/cn'
import {
  FileTree,
  FileTreeFile,
  FileTreeFolder,
  FileTreeFolderPanel,
  FileTreeFolderTrigger,
  FileTreeIcon,
  FileTreeLabel,
  FileTreeList,
} from '@langgenius/dify-ui/file-tree'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import { ScrollArea, ScrollAreaContent, ScrollAreaViewport } from '@langgenius/dify-ui/scroll-area'
import { Fragment } from 'react'
import { useTranslation } from 'react-i18next'

type AgentFileTreeFolderOpenStrategy = (context: { file: AgentFileNode; depth: number }) => boolean

type AgentFileTreeRenderFile = (context: {
  depth: number
  file: AgentFileNode
  selected: boolean
  children: ReactNode
}) => ReactNode

type AgentFileTreeRenderFolderPanel = (context: { depth: number; file: AgentFileNode }) => ReactNode

type AgentFileTreeRenderFolderSuffix = (context: {
  depth: number
  file: AgentFileNode
}) => ReactNode

type AgentFileTreeFolderOpenState = (context: { file: AgentFileNode; depth: number }) => boolean

const firstLevelFolderOpenStrategy: AgentFileTreeFolderOpenStrategy = ({ depth }) => depth === 1

function AgentFileTreeRows({
  files,
  selectedFileId,
  depth,
  folderOpenStrategy,
  folderOpenState,
  onFolderOpenChange,
  onFolderEnter,
  onFolderOpen,
  renderFile,
  renderFolderSuffix,
  renderFolderPanel,
}: {
  files: AgentFileNode[]
  selectedFileId?: string
  depth: number
  folderOpenStrategy: AgentFileTreeFolderOpenStrategy
  folderOpenState?: AgentFileTreeFolderOpenState
  onFolderOpenChange?: (context: { file: AgentFileNode; depth: number; open: boolean }) => void
  onFolderEnter?: (context: { file: AgentFileNode; depth: number }) => void
  onFolderOpen?: (file: AgentFileNode) => void
  renderFile: AgentFileTreeRenderFile
  renderFolderSuffix?: AgentFileTreeRenderFolderSuffix
  renderFolderPanel?: AgentFileTreeRenderFolderPanel
}) {
  const { t } = useTranslation(['common'])

  return files.map((file) => {
    const children = (
      <>
        <FileTreeIcon type={file.icon} />
        <FileTreeLabel className="max-w-full" title={file.name}>
          {file.name}
        </FileTreeLabel>
      </>
    )

    if (file.icon === 'folder') {
      return (
        <FileTreeFolder
          key={file.id}
          defaultOpen={folderOpenStrategy({ file, depth })}
          open={folderOpenState?.({ file, depth })}
          onOpenChange={(open) => onFolderOpenChange?.({ file, depth, open })}
        >
          <div className="flex min-w-0 items-center gap-0.5">
            <FileTreeFolderTrigger
              className="min-w-0 flex-1"
              onClick={() => onFolderOpen?.(file)}
              onDoubleClick={() => onFolderEnter?.({ file, depth })}
            >
              <FileTreeIcon type="folder" />
              <FileTreeLabel className="max-w-full" title={file.name}>
                {file.name}
              </FileTreeLabel>
              {renderFolderSuffix?.({ depth, file })}
            </FileTreeFolderTrigger>
            {onFolderEnter && (
              <IconButton
                aria-label={`${t(($) => $['operation.view'])} ${file.name}`}
                className="shrink-0"
                size="sm"
                onClick={() => onFolderEnter({ file, depth })}
              >
                <span aria-hidden className="i-ri-arrow-right-s-line size-4" />
              </IconButton>
            )}
          </div>
          <FileTreeFolderPanel>
            {renderFolderPanel?.({ depth, file })}
            <AgentFileTreeRows
              files={file.children ?? []}
              selectedFileId={selectedFileId}
              depth={depth + 1}
              folderOpenStrategy={folderOpenStrategy}
              folderOpenState={folderOpenState}
              onFolderOpenChange={onFolderOpenChange}
              onFolderEnter={onFolderEnter}
              onFolderOpen={onFolderOpen}
              renderFile={renderFile}
              renderFolderSuffix={renderFolderSuffix}
              renderFolderPanel={renderFolderPanel}
            />
          </FileTreeFolderPanel>
        </FileTreeFolder>
      )
    }

    return (
      <Fragment key={file.id}>
        {renderFile({
          depth,
          file,
          selected: file.id === selectedFileId,
          children,
        })}
      </Fragment>
    )
  })
}

const defaultRenderFile: AgentFileTreeRenderFile = ({ depth, selected, children }) => (
  <FileTreeFile level={depth} selected={selected}>
    {children}
  </FileTreeFile>
)

export function AgentFileTree({
  files,
  selectedFileId,
  id,
  treeLabel,
  treeLabelledBy,
  header,
  className,
  scrollAreaClassName,
  rootClassName,
  listClassName,
  folderOpenStrategy = firstLevelFolderOpenStrategy,
  folderOpenState,
  onFolderOpenChange,
  onFolderEnter,
  onFolderOpen,
  renderFile = defaultRenderFile,
  renderFolderSuffix,
  renderFolderPanel,
}: {
  files: AgentFileNode[]
  selectedFileId?: string
  id?: string
  treeLabel?: string
  treeLabelledBy?: string
  header?: ReactNode
  className?: string
  scrollAreaClassName?: string
  rootClassName?: string
  listClassName?: string
  folderOpenStrategy?: AgentFileTreeFolderOpenStrategy
  folderOpenState?: AgentFileTreeFolderOpenState
  onFolderOpenChange?: (context: { file: AgentFileNode; depth: number; open: boolean }) => void
  onFolderEnter?: (context: { file: AgentFileNode; depth: number }) => void
  onFolderOpen?: (file: AgentFileNode) => void
  renderFile?: AgentFileTreeRenderFile
  renderFolderSuffix?: AgentFileTreeRenderFolderSuffix
  renderFolderPanel?: AgentFileTreeRenderFolderPanel
}) {
  return (
    <div className={cn('flex min-h-0 w-full max-w-full min-w-0 flex-col overflow-clip', className)}>
      {header}
      <ScrollArea
        className={cn('min-h-0 w-full max-w-full flex-1 overflow-hidden', scrollAreaClassName)}
      >
        <ScrollAreaViewport
          aria-label={treeLabel}
          aria-labelledby={treeLabelledBy}
          className="max-h-[inherit]"
          role={treeLabel || treeLabelledBy ? 'region' : undefined}
        >
          <ScrollAreaContent style={{ minWidth: 0 }} className="w-full max-w-full">
            <FileTree id={id} className={cn('w-full max-w-full min-w-0 p-0', rootClassName)}>
              <FileTreeList className={cn('w-full max-w-full min-w-0', listClassName)}>
                <AgentFileTreeRows
                  files={files}
                  selectedFileId={selectedFileId}
                  depth={1}
                  folderOpenStrategy={folderOpenStrategy}
                  folderOpenState={folderOpenState}
                  onFolderOpenChange={onFolderOpenChange}
                  onFolderEnter={onFolderEnter}
                  onFolderOpen={onFolderOpen}
                  renderFile={renderFile}
                  renderFolderSuffix={renderFolderSuffix}
                  renderFolderPanel={renderFolderPanel}
                />
              </FileTreeList>
            </FileTree>
          </ScrollAreaContent>
        </ScrollAreaViewport>
      </ScrollArea>
    </div>
  )
}
