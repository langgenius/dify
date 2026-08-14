'use client'

import type {
  SkillDetailResponse,
  SkillFileResponse,
} from '@dify/contracts/api/console/workspaces/types.gen'
import type { DragEvent, MouseEvent, ReactElement } from 'react'
import type { SkillDropTarget } from './file-tree-dnd'
import type { FileTreeInlineAction, FileTreeNode } from './shared'
import { cn } from '@langgenius/dify-ui/cn'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@langgenius/dify-ui/context-menu'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@langgenius/dify-ui/dropdown-menu'
import { Kbd, KbdGroup } from '@langgenius/dify-ui/kbd'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { setSkillFileDragPreview } from './file-tree-drag-preview'
import {
  getDraggedSkillPaths,
  getSkillFileIconClass,
  skillFileDragPathsType,
  skillFileDragType,
  skillFileHotkeys,
  skillFileMenuPopupClassName,
} from './shared'

export function FileTreeNameInput({
  file,
  initialValue = '',
  loading,
  nodeType,
  onCancel,
  onSubmit,
  placeholder,
  selectBaseName = false,
}: {
  file?: SkillFileResponse
  initialValue?: string
  loading: boolean
  nodeType: 'directory' | 'file'
  onCancel: () => void
  onSubmit: (path: string) => void
  placeholder?: string
  selectBaseName?: boolean
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const submittedRef = useRef(false)
  const [name, setName] = useState(initialValue)

  useLayoutEffect(() => {
    const input = inputRef.current
    if (!input) return

    input.focus()
    if (!selectBaseName) return

    const extensionIndex = initialValue.lastIndexOf('.')
    input.setSelectionRange(0, extensionIndex > 0 ? extensionIndex : initialValue.length)
  }, [initialValue, selectBaseName])

  useEffect(() => {
    if (!loading) submittedRef.current = false
  }, [loading])

  const handleSubmit = () => {
    if (loading || submittedRef.current) return

    const trimmedName = name.trim()
    if (!trimmedName) return

    submittedRef.current = true
    onSubmit(trimmedName)
  }

  return (
    <div data-skill-file-tree-item className="flex h-6 min-w-0 items-center gap-0.5 px-2 pr-1.5">
      <span
        aria-hidden
        className={cn(
          'size-4 shrink-0 text-text-secondary',
          nodeType === 'directory'
            ? 'i-ri-folder-5-line'
            : file
              ? getSkillFileIconClass(file)
              : 'i-ri-file-line',
        )}
      />
      <input
        ref={inputRef}
        value={name}
        placeholder={placeholder}
        disabled={loading}
        className="h-5 w-0 min-w-0 flex-1 rounded-[5px] border border-components-input-border-active bg-components-input-bg-active px-1 py-0.5 system-xs-regular text-text-secondary shadow-xs outline-hidden placeholder:text-text-quaternary focus:ring-0 disabled:cursor-wait"
        onBlur={() => {
          if (name.trim()) handleSubmit()
          else onCancel()
        }}
        onChange={(event) => setName(event.target.value)}
        onContextMenu={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
            event.preventDefault()
            handleSubmit()
          }
          if (event.key === 'Escape') {
            event.preventDefault()
            onCancel()
          }
        }}
      />
    </div>
  )
}

function FileActionMenuItems({
  kind,
  node,
  onCopy,
  onCreateFile,
  onCreateFolder,
  onCut,
  onDelete,
  onRename,
  onUploadFiles,
}: {
  kind: 'context' | 'dropdown'
  node: FileTreeNode
  onCopy: (path: string) => void
  onCreateFile: () => void
  onCreateFolder: () => void
  onCut: (path: string) => void
  onDelete: () => void
  onRename: () => void
  onUploadFiles: () => void
}) {
  const { t } = useTranslation('skill')
  const { t: tCommon } = useTranslation('common')
  const MenuItem = kind === 'context' ? ContextMenuItem : DropdownMenuItem
  const MenuSeparator = kind === 'context' ? ContextMenuSeparator : DropdownMenuSeparator
  const isDirectoryNode = node.type === 'directory'

  return (
    <>
      {!isDirectoryNode && (
        <>
          <MenuItem
            className="gap-2"
            onClick={(event) => {
              event.stopPropagation()
              onCut(node.path)
            }}
          >
            <span aria-hidden className="i-ri-scissors-cut-line size-4 text-text-tertiary" />
            <span>{t(($) => $['skillManagement.detail.cutFile'])}</span>
            <KbdGroup className="ml-auto">
              {skillFileHotkeys.cut.keycaps.map((keycap) => (
                <Kbd key={keycap}>{keycap}</Kbd>
              ))}
            </KbdGroup>
          </MenuItem>
          <MenuItem
            className="gap-2"
            onClick={(event) => {
              event.stopPropagation()
              onCopy(node.path)
            }}
          >
            <span aria-hidden className="i-ri-file-copy-line size-4 text-text-tertiary" />
            <span>{t(($) => $['skillManagement.detail.copyFile'])}</span>
            <KbdGroup className="ml-auto">
              {skillFileHotkeys.copy.keycaps.map((keycap) => (
                <Kbd key={keycap}>{keycap}</Kbd>
              ))}
            </KbdGroup>
          </MenuItem>
          <MenuSeparator />
        </>
      )}
      {isDirectoryNode && (
        <>
          <MenuItem
            className="gap-2"
            onClick={(event) => {
              event.stopPropagation()
              onCreateFile()
            }}
          >
            <span aria-hidden className="i-ri-file-add-line size-4 text-text-tertiary" />
            <span>{t(($) => $['skillManagement.detail.createFileMenu'])}</span>
          </MenuItem>
          <MenuItem
            className="gap-2"
            onClick={(event) => {
              event.stopPropagation()
              onCreateFolder()
            }}
          >
            <span aria-hidden className="i-ri-folder-add-line size-4 text-text-tertiary" />
            <span>{t(($) => $['skillManagement.detail.createFolderMenu'])}</span>
          </MenuItem>
          <MenuItem
            className="gap-2"
            onClick={(event) => {
              event.stopPropagation()
              onUploadFiles()
            }}
          >
            <span aria-hidden className="i-ri-upload-cloud-2-line size-4 text-text-tertiary" />
            <span>{t(($) => $['skillManagement.detail.uploadFilesMenu'])}</span>
          </MenuItem>
          <MenuSeparator />
        </>
      )}
      <MenuItem
        className="gap-2"
        onClick={(event) => {
          event.stopPropagation()
          onRename()
        }}
      >
        <span aria-hidden className="i-ri-input-field size-4 text-text-tertiary" />
        <span>{tCommon(($) => $['operation.rename'])}...</span>
      </MenuItem>
      <MenuSeparator />
      <MenuItem
        className="gap-2"
        onClick={(event) => {
          event.stopPropagation()
          onDelete()
        }}
      >
        <span aria-hidden className="i-ri-delete-bin-line size-4 text-text-tertiary" />
        <span>{tCommon(($) => $['operation.delete'])}</span>
      </MenuItem>
    </>
  )
}

function FileActions({
  visible,
  node,
  onCopy,
  onCreateFile,
  onCreateFolder,
  onCut,
  onDelete,
  onRename,
  onUploadFiles,
}: {
  visible: boolean
  node: FileTreeNode
  onCopy: (path: string) => void
  onCreateFile: () => void
  onCreateFolder: () => void
  onCut: (path: string) => void
  onDelete: () => void
  onRename: () => void
  onUploadFiles: (files: File[], targetDirectory: string | undefined) => void
}) {
  const { t: tCommon } = useTranslation('common')
  const uploadInputRef = useRef<HTMLInputElement>(null)

  return (
    <>
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger
          aria-label={tCommon(($) => $['operation.more'])}
          className={cn(
            'relative z-10 size-5 shrink-0 cursor-pointer items-center justify-center rounded-md text-text-tertiary outline-hidden hover:bg-state-base-hover hover:text-text-secondary focus-visible:ring-2 focus-visible:ring-state-accent-solid data-popup-open:flex data-popup-open:bg-state-base-hover',
            visible ? 'flex' : 'hidden group-hover:flex',
          )}
          onClick={(event) => event.stopPropagation()}
        >
          <span aria-hidden className="i-ri-more-fill size-4" />
        </DropdownMenuTrigger>
        <DropdownMenuContent placement="bottom-end" popupClassName={skillFileMenuPopupClassName}>
          <FileActionMenuItems
            kind="dropdown"
            node={node}
            onCopy={onCopy}
            onCreateFile={onCreateFile}
            onCreateFolder={onCreateFolder}
            onCut={onCut}
            onDelete={onDelete}
            onRename={onRename}
            onUploadFiles={() => uploadInputRef.current?.click()}
          />
        </DropdownMenuContent>
      </DropdownMenu>
      <input
        ref={uploadInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={(event) => {
          onUploadFiles(Array.from(event.target.files ?? []), node.path)
          event.target.value = ''
        }}
      />
    </>
  )
}

export function RootFileActionMenuItems({
  kind,
  onCreateFile,
  onCreateFolder,
  onUploadFiles,
}: {
  kind: 'context' | 'dropdown'
  onCreateFile: () => void
  onCreateFolder: () => void
  onUploadFiles: () => void
}) {
  const { t } = useTranslation('skill')
  const MenuItem = kind === 'context' ? ContextMenuItem : DropdownMenuItem

  return (
    <>
      <MenuItem className="gap-2" onClick={onCreateFile}>
        <span aria-hidden className="i-ri-file-add-line size-4 text-text-secondary" />
        <span className="system-sm-regular">
          {t(($) => $['skillManagement.detail.createFileMenu'])}
        </span>
      </MenuItem>
      <MenuItem className="gap-2" onClick={onCreateFolder}>
        <span aria-hidden className="i-ri-folder-add-line size-4 text-text-secondary" />
        <span className="system-sm-regular">
          {t(($) => $['skillManagement.detail.createFolderMenu'])}
        </span>
      </MenuItem>
      <MenuItem className="gap-2" onClick={onUploadFiles}>
        <span aria-hidden className="i-ri-upload-cloud-2-line size-4 text-text-secondary" />
        <span className="system-sm-regular">
          {t(($) => $['skillManagement.detail.uploadFilesMenu'])}
        </span>
      </MenuItem>
    </>
  )
}

export function FileTreeItem({
  collapsedFolderPaths,
  detail,
  draggingPaths,
  dropTarget,
  inlineAction,
  inlineActionLoading,
  node,
  onCancelInlineAction,
  onCreate,
  onDropFiles,
  onCopy,
  onCut,
  onDelete,
  onItemSelect,
  onMove,
  onRename,
  onSelect,
  onExpandFolder,
  onSetDraggingPaths,
  onSetDropTarget,
  onSubmitInlineAction,
  onToggleFolder,
  onUploadFiles,
  readonly,
  selectedPaths,
  selectedPath,
}: {
  collapsedFolderPaths: string[]
  detail: SkillDetailResponse | undefined
  draggingPaths: string[]
  dropTarget: SkillDropTarget | undefined
  inlineAction: FileTreeInlineAction | undefined
  inlineActionLoading: boolean
  node: FileTreeNode
  onCancelInlineAction: () => void
  onCreate: (nodeType: 'directory' | 'file', parentPath?: string) => void
  onDropFiles: (files: File[], targetDirectory: string | undefined) => void
  onCopy: (path: string) => void
  onCut: (path: string) => void
  onDelete: (node: FileTreeNode) => void
  onItemSelect: (node: FileTreeNode, event: MouseEvent<HTMLElement>) => void
  onMove: (sourcePaths: string[], targetDirectory: string | undefined) => void
  onRename: (node: FileTreeNode) => void
  onSelect: (path: string, mode: 'pinned' | 'preview') => void
  onExpandFolder: (path: string) => void
  onSetDraggingPaths: (paths: string[]) => void
  onSetDropTarget: (target: SkillDropTarget | undefined) => void
  onSubmitInlineAction: (name: string) => void
  onToggleFolder: (path: string) => void
  onUploadFiles: (files: File[], targetDirectory: string | undefined) => void
  readonly: boolean
  selectedPaths: string[]
  selectedPath: string | undefined
}) {
  const contextUploadInputRef = useRef<HTMLInputElement>(null)
  const expandTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const isDragging = draggingPaths.includes(node.path)
  const isDropTarget = node.type === 'directory' && dropTarget?.path === node.path
  const isSelected = selectedPaths.includes(node.path)
  const isCollapsed = collapsedFolderPaths.includes(node.path)
  const actionsVisible = isSelected || selectedPath === node.path
  const isRenaming = inlineAction?.kind === 'rename' && inlineAction.path === node.path
  const childCreateAction =
    inlineAction?.kind === 'create' && inlineAction.parentPath === node.path
      ? inlineAction
      : undefined

  useEffect(
    () => () => {
      if (expandTimerRef.current) clearTimeout(expandTimerRef.current)
    },
    [],
  )

  const handleDragStart = (event: DragEvent<HTMLElement>) => {
    if (readonly) {
      event.preventDefault()
      return
    }

    const sourcePaths = isSelected ? selectedPaths : [node.path]
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData(skillFileDragType, node.path)
    event.dataTransfer.setData(skillFileDragPathsType, JSON.stringify(sourcePaths))
    setSkillFileDragPreview(event, {
      count: sourcePaths.length,
      iconClassName:
        node.type === 'directory'
          ? 'i-ri-folder-5-line text-text-secondary'
          : node.file
            ? getSkillFileIconClass(node.file)
            : 'i-ri-file-line text-text-secondary',
      name: node.name,
    })
    onSetDraggingPaths(sourcePaths)
  }

  const handleDragEnd = () => {
    if (expandTimerRef.current) clearTimeout(expandTimerRef.current)
    onSetDraggingPaths([])
    onSetDropTarget(undefined)
  }

  const handleDragOver = (event: DragEvent<HTMLElement>) => {
    if (readonly) return

    event.preventDefault()
    event.stopPropagation()
    const operation = Array.from(event.dataTransfer.types).includes('Files') ? 'upload' : 'move'
    event.dataTransfer.dropEffect = operation === 'upload' ? 'copy' : 'move'
    onSetDropTarget({ operation, path: node.path })
    if (isCollapsed && node.children?.length && !expandTimerRef.current) {
      expandTimerRef.current = setTimeout(() => {
        onExpandFolder(node.path)
        expandTimerRef.current = undefined
      }, 2000)
    }
  }

  const handleDragLeave = (event: DragEvent<HTMLElement>) => {
    if (readonly) return
    if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget))
      return

    if (expandTimerRef.current) {
      clearTimeout(expandTimerRef.current)
      expandTimerRef.current = undefined
    }
    onSetDropTarget(undefined)
  }

  const handleDrop = (event: DragEvent<HTMLElement>) => {
    if (readonly) return

    event.preventDefault()
    event.stopPropagation()
    if (expandTimerRef.current) {
      clearTimeout(expandTimerRef.current)
      expandTimerRef.current = undefined
    }
    onSetDropTarget(undefined)

    const droppedFiles = Array.from(event.dataTransfer.files)
    if (droppedFiles.length > 0) {
      onDropFiles(droppedFiles, node.path)
      return
    }

    const sourcePaths = getDraggedSkillPaths(event.dataTransfer)
    if (sourcePaths.length > 0) onMove(sourcePaths, node.path)
  }

  const nameNode = <span className="w-0 min-w-0 flex-1 truncate">{node.name}</span>

  const renderWithContextMenu = (trigger: ReactElement) => {
    if (readonly || !detail) return trigger

    return (
      <>
        <ContextMenu>
          <ContextMenuTrigger render={trigger} />
          <ContextMenuContent popupClassName={skillFileMenuPopupClassName}>
            <FileActionMenuItems
              kind="context"
              node={node}
              onCopy={onCopy}
              onCreateFile={() => onCreate('file', node.path)}
              onCreateFolder={() => onCreate('directory', node.path)}
              onCut={onCut}
              onDelete={() => onDelete(node)}
              onRename={() => onRename(node)}
              onUploadFiles={() => contextUploadInputRef.current?.click()}
            />
          </ContextMenuContent>
        </ContextMenu>
        <input
          ref={contextUploadInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={(event) => {
            onUploadFiles(Array.from(event.target.files ?? []), node.path)
            event.target.value = ''
          }}
        />
      </>
    )
  }

  if (node.type === 'directory') {
    return (
      <li
        className="min-w-0"
        onDragLeave={handleDragLeave}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
      >
        {isRenaming ? (
          <FileTreeNameInput
            initialValue={node.name}
            loading={inlineActionLoading}
            nodeType="directory"
            onCancel={onCancelInlineAction}
            onSubmit={onSubmitInlineAction}
            selectBaseName
          />
        ) : (
          renderWithContextMenu(
            <div
              data-skill-file-tree-item
              draggable={!readonly}
              className={cn(
                'group flex h-6 w-full min-w-0 items-center gap-2 rounded-md pr-1.5 pl-2 system-xs-regular text-text-secondary outline-hidden transition-colors hover:bg-components-panel-on-panel-item-bg-hover hover:text-text-primary focus-visible:ring-2 focus-visible:ring-state-accent-solid',
                isDropTarget && 'bg-state-accent-hover ring-1 ring-state-accent-solid ring-inset',
                isSelected && 'bg-state-accent-hover text-text-accent',
                isDragging && 'opacity-30',
              )}
              role="button"
              tabIndex={0}
              title={node.path}
              onClick={(event) => onItemSelect(node, event)}
              onContextMenu={(event) => {
                event.stopPropagation()
                onItemSelect(node, event)
              }}
              onDragEnd={handleDragEnd}
              onDragStart={handleDragStart}
              onDoubleClick={() => onToggleFolder(node.path)}
              onKeyDown={(event) => {
                if (event.key !== 'Enter' && event.key !== ' ') return
                event.preventDefault()
                onItemSelect(node, event as unknown as MouseEvent<HTMLElement>)
              }}
            >
              <span
                aria-hidden
                className="i-ri-folder-5-line size-4 shrink-0 text-text-secondary"
              />
              {nameNode}
              {!readonly && detail && (
                <FileActions
                  node={node}
                  onCopy={onCopy}
                  onCreateFile={() => onCreate('file', node.path)}
                  onCreateFolder={() => onCreate('directory', node.path)}
                  onCut={onCut}
                  onDelete={() => onDelete(node)}
                  onRename={() => onRename(node)}
                  onUploadFiles={onUploadFiles}
                  visible={actionsVisible}
                />
              )}
            </div>,
          )
        )}
        {(childCreateAction || (!isCollapsed && node.children && node.children.length > 0)) && (
          <ul className="ml-4 min-w-0 space-y-px border-l border-divider-subtle pl-1">
            {childCreateAction && (
              <FileTreeNameInput
                loading={inlineActionLoading}
                nodeType={childCreateAction.nodeType}
                onCancel={onCancelInlineAction}
                onSubmit={onSubmitInlineAction}
                placeholder={childCreateAction.nodeType === 'file' ? 'File name' : 'Folder name'}
              />
            )}
            {node.children?.map((child) => (
              <FileTreeItem
                collapsedFolderPaths={collapsedFolderPaths}
                detail={detail}
                draggingPaths={draggingPaths}
                dropTarget={dropTarget}
                inlineAction={inlineAction}
                inlineActionLoading={inlineActionLoading}
                key={child.id}
                node={child}
                onCancelInlineAction={onCancelInlineAction}
                onCopy={onCopy}
                onCreate={onCreate}
                onCut={onCut}
                onDelete={onDelete}
                onDropFiles={onDropFiles}
                onItemSelect={onItemSelect}
                onMove={onMove}
                onRename={onRename}
                onSelect={onSelect}
                onExpandFolder={onExpandFolder}
                onSetDraggingPaths={onSetDraggingPaths}
                onSetDropTarget={onSetDropTarget}
                onSubmitInlineAction={onSubmitInlineAction}
                onToggleFolder={onToggleFolder}
                onUploadFiles={onUploadFiles}
                readonly={readonly}
                selectedPaths={selectedPaths}
                selectedPath={selectedPath}
              />
            ))}
          </ul>
        )}
      </li>
    )
  }

  if (isRenaming) {
    return (
      <li className="min-w-0">
        <FileTreeNameInput
          file={node.file}
          initialValue={node.name}
          loading={inlineActionLoading}
          nodeType="file"
          onCancel={onCancelInlineAction}
          onSubmit={onSubmitInlineAction}
          selectBaseName
        />
      </li>
    )
  }

  return (
    <li className="min-w-0">
      {renderWithContextMenu(
        <div
          data-skill-file-tree-item
          draggable={!readonly}
          className={cn(
            'group flex h-6 w-full min-w-0 items-center rounded-md pr-1.5 text-text-secondary transition-colors hover:bg-components-panel-on-panel-item-bg-hover hover:text-text-primary',
            (selectedPath === node.path || isSelected) && 'bg-state-accent-hover text-text-accent',
            isDragging && 'opacity-30',
          )}
          onDragEnd={handleDragEnd}
          onDragStart={handleDragStart}
          onContextMenu={(event) => {
            event.stopPropagation()
            onItemSelect(node, event)
          }}
        >
          <button
            type="button"
            className="flex h-full w-0 min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-md px-2 text-left system-xs-regular outline-hidden transition-colors group-hover:text-text-primary focus-visible:ring-2 focus-visible:ring-state-accent-solid"
            title={node.path}
            onClick={(event) => {
              onItemSelect(node, event)
              if (!event.shiftKey && !event.metaKey && !event.ctrlKey)
                onSelect(node.path, 'preview')
            }}
            onDoubleClick={() => onSelect(node.path, 'pinned')}
          >
            <span
              aria-hidden
              className={cn('size-4 shrink-0', node.file && getSkillFileIconClass(node.file))}
            />
            {nameNode}
          </button>
          {!readonly && detail && (
            <div className="flex shrink-0 items-center">
              <FileActions
                node={node}
                onCopy={onCopy}
                onCreateFile={() => onCreate('file', node.path)}
                onCreateFolder={() => onCreate('directory', node.path)}
                onCut={onCut}
                onDelete={() => onDelete(node)}
                onRename={() => onRename(node)}
                onUploadFiles={onUploadFiles}
                visible={actionsVisible}
              />
            </div>
          )}
        </div>,
      )}
    </li>
  )
}
