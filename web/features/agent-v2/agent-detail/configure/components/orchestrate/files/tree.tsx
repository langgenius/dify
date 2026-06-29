'use client'

import type { ReactNode } from 'react'
import type { AgentFileNode } from '@/features/agent-v2/agent-composer/form-state'
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
import { ScrollArea } from '@langgenius/dify-ui/scroll-area'
import { Fragment } from 'react'

type AgentFileTreeFolderOpenStrategy = (context: {
  file: AgentFileNode
  depth: number
}) => boolean

type AgentFileTreeRenderFile = (context: {
  depth: number
  file: AgentFileNode
  selected: boolean
  children: ReactNode
}) => ReactNode

type AgentFileTreeRenderFolderPanel = (context: {
  depth: number
  file: AgentFileNode
}) => ReactNode

type AgentFileTreeFolderOpenState = (context: {
  file: AgentFileNode
  depth: number
}) => boolean

const firstLevelFolderOpenStrategy: AgentFileTreeFolderOpenStrategy = ({ depth }) => depth === 1

function AgentFileTreeRows({
  files,
  selectedFileId,
  depth,
  folderOpenStrategy,
  folderOpenState,
  onFolderOpenChange,
  onFolderOpen,
  renderFile,
  renderFolderPanel,
}: {
  files: AgentFileNode[]
  selectedFileId?: string
  depth: number
  folderOpenStrategy: AgentFileTreeFolderOpenStrategy
  folderOpenState?: AgentFileTreeFolderOpenState
  onFolderOpenChange?: (context: { file: AgentFileNode, depth: number, open: boolean }) => void
  onFolderOpen?: (file: AgentFileNode) => void
  renderFile: AgentFileTreeRenderFile
  renderFolderPanel?: AgentFileTreeRenderFolderPanel
}) {
  return files.map((file) => {
    const children = (
      <>
        <FileTreeIcon type={file.icon} />
        <FileTreeLabel className="max-w-full" title={file.name}>{file.name}</FileTreeLabel>
      </>
    )

    if (file.icon === 'folder') {
      return (
        <FileTreeFolder
          key={file.id}
          defaultOpen={folderOpenStrategy({ file, depth })}
          open={folderOpenState?.({ file, depth })}
          onOpenChange={open => onFolderOpenChange?.({ file, depth, open })}
        >
          <FileTreeFolderTrigger onClick={() => onFolderOpen?.(file)}>
            <FileTreeIcon type="folder" />
            <FileTreeLabel className="max-w-full" title={file.name}>{file.name}</FileTreeLabel>
          </FileTreeFolderTrigger>
          <FileTreeFolderPanel>
            {renderFolderPanel?.({ depth, file })}
            <AgentFileTreeRows
              files={file.children ?? []}
              selectedFileId={selectedFileId}
              depth={depth + 1}
              folderOpenStrategy={folderOpenStrategy}
              folderOpenState={folderOpenState}
              onFolderOpenChange={onFolderOpenChange}
              onFolderOpen={onFolderOpen}
              renderFile={renderFile}
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

const defaultRenderFile: AgentFileTreeRenderFile = ({ selected, children }) => (
  <FileTreeFile selected={selected}>
    {children}
  </FileTreeFile>
)

export function AgentFileTree({
  files,
  selectedFileId,
  id,
  treeLabel,
  label,
  labelledBy,
  header,
  className,
  scrollAreaClassName,
  rootClassName,
  listClassName,
  folderOpenStrategy = firstLevelFolderOpenStrategy,
  folderOpenState,
  onFolderOpenChange,
  onFolderOpen,
  renderFile = defaultRenderFile,
  renderFolderPanel,
}: {
  files: AgentFileNode[]
  selectedFileId?: string
  id?: string
  treeLabel?: string
  label?: string
  labelledBy?: string
  header?: ReactNode
  className?: string
  scrollAreaClassName?: string
  rootClassName?: string
  listClassName?: string
  folderOpenStrategy?: AgentFileTreeFolderOpenStrategy
  folderOpenState?: AgentFileTreeFolderOpenState
  onFolderOpenChange?: (context: { file: AgentFileNode, depth: number, open: boolean }) => void
  onFolderOpen?: (file: AgentFileNode) => void
  renderFile?: AgentFileTreeRenderFile
  renderFolderPanel?: AgentFileTreeRenderFolderPanel
}) {
  return (
    <div className={cn('flex min-h-0 w-full max-w-full min-w-0 flex-col overflow-clip', className)}>
      {header}
      <ScrollArea
        className={cn('min-h-0 w-full max-w-full flex-1 overflow-hidden', scrollAreaClassName)}
        label={label}
        labelledBy={labelledBy}
        slotClassNames={{
          viewport: 'max-h-[inherit] overscroll-contain',
          content: 'w-full max-w-full min-w-0!',
          scrollbar: 'hidden',
        }}
      >
        <FileTreeRoot
          id={id}
          aria-label={treeLabel}
          className={cn('w-full max-w-full min-w-0 p-0', rootClassName)}
        >
          <FileTreeList className={cn('w-full max-w-full min-w-0', listClassName)}>
            <AgentFileTreeRows
              files={files}
              selectedFileId={selectedFileId}
              depth={1}
              folderOpenStrategy={folderOpenStrategy}
              folderOpenState={folderOpenState}
              onFolderOpenChange={onFolderOpenChange}
              onFolderOpen={onFolderOpen}
              renderFile={renderFile}
              renderFolderPanel={renderFolderPanel}
            />
          </FileTreeList>
        </FileTreeRoot>
      </ScrollArea>
    </div>
  )
}
