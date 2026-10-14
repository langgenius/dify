'use client'

import type {
  CollapsiblePanelProps,
  CollapsibleProps,
  CollapsibleTriggerProps,
} from '@langgenius/dify-ui/collapsible'
import { cn } from '@langgenius/dify-ui/cn'
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from '@langgenius/dify-ui/collapsible'
import { mergeProps } from '@langgenius/dify-ui/merge-props'
import { useRender } from '@langgenius/dify-ui/use-render'
import * as React from 'react'

const insetFocusRingClassName =
  'focus-visible:inset-ring-2 focus-visible:inset-ring-state-accent-solid focus-visible:outline-hidden'

function resolveClassName<State>(
  className: string | ((state: State) => string | undefined) | undefined,
  state: State,
) {
  return typeof className === 'function' ? className(state) : className
}

const FileTreeLevelContext = React.createContext(1)

function useFileTreeLevel() {
  return React.use(FileTreeLevelContext)
}

function renderGuides(level: number) {
  return Array.from({ length: Math.max(level - 1, 0) }, (_, index) => <FileTreeGuide key={index} />)
}

type FileTreeFileState = {
  selected: boolean
  disabled: boolean
  level: number
}

function fileTreeRowClassName({ className }: { className?: string }) {
  return cn(
    'group/file-tree-row relative flex h-6 w-full min-w-0 items-center rounded-md ps-2 pe-1.5 text-start select-none',
    'hover:bg-state-base-hover',
    insetFocusRingClassName,
    'data-selected:bg-state-base-active',
    'data-disabled:cursor-not-allowed data-disabled:opacity-50 data-disabled:hover:bg-transparent',
    className,
  )
}

type FileTreeProps = useRender.ComponentProps<'section'>

function FileTree({ render, className, children, ...props }: FileTreeProps) {
  const defaultProps: useRender.ElementProps<'section'> = {
    className: cn('flex min-w-0 flex-col gap-px p-1', className),
    children: <FileTreeLevelContext value={1}>{children}</FileTreeLevelContext>,
  }

  return useRender({
    defaultTagName: 'section',
    render,
    props: mergeProps<'section'>(defaultProps, props),
  })
}

type FileTreeListProps = useRender.ComponentProps<'ul'>

function FileTreeList({ render, className, ...props }: FileTreeListProps) {
  const defaultProps: useRender.ElementProps<'ul'> = {
    className: cn('m-0 flex min-w-0 list-none flex-col gap-px p-0', className),
  }

  return useRender({
    defaultTagName: 'ul',
    render,
    props: mergeProps<'ul'>(defaultProps, props),
  })
}

type FileTreeFolderProps = CollapsibleProps

function FileTreeFolder({ render = <li />, className, ...props }: FileTreeFolderProps) {
  return (
    <Collapsible
      render={render}
      className={(state) => cn('!block min-w-0', resolveClassName(className, state))}
      {...props}
    />
  )
}

type FileTreeFolderTriggerProps = CollapsibleTriggerProps & {
  level?: number
}

function FileTreeFolderTrigger({
  className,
  children,
  disabled,
  level: levelProp,
  ...props
}: FileTreeFolderTriggerProps) {
  const contextLevel = useFileTreeLevel()
  const level = levelProp ?? contextLevel

  return (
    <CollapsibleTrigger
      className={(state) =>
        fileTreeRowClassName({
          className: cn('focus-visible:!ring-0', resolveClassName(className, state)),
        })
      }
      disabled={disabled}
      {...props}
    >
      {renderGuides(level)}
      <div className="flex min-w-0 flex-[1_0_0] items-center py-0.5">{children}</div>
    </CollapsibleTrigger>
  )
}

type FileTreeFolderPanelProps = CollapsiblePanelProps

function FileTreeFolderPanel({
  render = <ul />,
  className,
  children,
  ...props
}: FileTreeFolderPanelProps) {
  const level = useFileTreeLevel()

  return (
    <CollapsiblePanel
      render={render}
      className={(state) =>
        cn(
          'm-0 flex !h-auto min-w-0 list-none flex-col gap-px !overflow-visible p-0 !transition-none',
          resolveClassName(className, state),
        )
      }
      {...props}
    >
      <FileTreeLevelContext value={level + 1}>{children}</FileTreeLevelContext>
    </CollapsiblePanel>
  )
}

type FileTreeFileProps = Omit<useRender.ComponentProps<'button', FileTreeFileState>, 'type'> & {
  level?: number
  selected?: boolean
}

function FileTreeFile({
  render,
  className,
  children,
  disabled = false,
  level: levelProp,
  selected = false,
  ...props
}: FileTreeFileProps) {
  const contextLevel = useFileTreeLevel()
  const level = levelProp ?? contextLevel
  const state: FileTreeFileState = {
    selected,
    disabled,
    level,
  }
  const defaultProps = {
    type: 'button',
    disabled,
    'data-selected': selected || undefined,
    'data-disabled': disabled || undefined,
    'aria-current': selected ? 'true' : undefined,
    className: fileTreeRowClassName({ className }),
    children: (
      <React.Fragment>
        {renderGuides(level)}
        <div className="flex min-w-0 flex-[1_0_0] items-center py-0.5">{children}</div>
      </React.Fragment>
    ),
  } as useRender.ElementProps<'button'>

  const file = useRender({
    defaultTagName: 'button',
    render,
    state,
    props: mergeProps<'button'>(defaultProps, props),
  })

  return <li className="min-w-0">{file}</li>
}

type FileTreeGuideProps = useRender.ComponentProps<'span'>

function FileTreeGuide({ render, className, ...props }: FileTreeGuideProps) {
  const defaultProps: useRender.ElementProps<'span'> = {
    'aria-hidden': true,
    className: cn(
      'relative h-6 w-5 shrink-0 before:absolute before:top-0 before:-bottom-px before:left-1/2 before:w-px before:-translate-x-1/2 before:bg-divider-subtle',
      className,
    ),
  }

  return useRender({
    defaultTagName: 'span',
    render,
    props: mergeProps<'span'>(defaultProps, props),
  })
}

type FileTreeIconType =
  | 'folder'
  | 'file'
  | 'markdown'
  | 'json'
  | 'image'
  | 'code'
  | 'database'
  | 'text'
  | 'pdf'
  | 'table'
  | 'archive'

const fileTreeIconClassNames: Record<Exclude<FileTreeIconType, 'folder'>, string> = {
  file: 'i-ri-file-3-fill text-[#A4AABF]',
  markdown: 'i-ri-markdown-fill text-[#309BEC]',
  json: 'i-ri-braces-fill text-[#A4AABF]',
  image: 'i-ri-file-image-fill text-[#00B2EA]',
  code: 'i-ri-file-code-fill text-[#A4AABF]',
  database: 'i-ri-database-2-fill text-[#A4AABF]',
  text: 'i-ri-file-text-fill text-[#6F8BB5]',
  pdf: 'i-ri-file-pdf-2-fill text-[#EA3434]',
  table: 'i-ri-file-excel-fill text-[#01AC49]',
  archive: 'i-ri-file-zip-fill text-[#A4AABF]',
}

type FileTreeIconProps = Omit<useRender.ComponentProps<'span'>, 'children'> & {
  type?: FileTreeIconType
  children?: React.ReactNode
}

function FileTreeIcon({ type = 'file', render, className, children, ...props }: FileTreeIconProps) {
  const defaultProps: useRender.ElementProps<'span'> = {
    'aria-hidden': true,
    className: cn(
      'relative flex size-5 shrink-0 items-center justify-center text-text-secondary',
      className,
    ),
    children: (
      <React.Fragment>
        {children ??
          (type === 'folder' ? (
            <React.Fragment>
              <span className="i-ri-folder-line size-4 group-data-panel-open/file-tree-row:hidden" />
              <span className="i-ri-folder-open-line hidden size-4 text-text-secondary group-data-panel-open/file-tree-row:block" />
            </React.Fragment>
          ) : (
            <span className={cn('size-4', fileTreeIconClassNames[type])} />
          ))}
      </React.Fragment>
    ),
  }

  return useRender({
    defaultTagName: 'span',
    render,
    props: mergeProps<'span'>(defaultProps, props),
  })
}

type FileTreeLabelProps = useRender.ComponentProps<'span'>

function FileTreeLabel({ render, className, children, ...props }: FileTreeLabelProps) {
  const defaultProps = {
    className: cn(
      'w-0 min-w-0 flex-1 truncate rounded-[5px] px-1 py-0.5',
      'system-sm-regular text-text-secondary group-data-selected/file-tree-row:system-sm-medium group-data-selected/file-tree-row:text-text-primary',
      className,
    ),
    children,
  } satisfies useRender.ElementProps<'span'>

  return useRender({
    defaultTagName: 'span',
    render,
    props: mergeProps<'span'>(defaultProps, props),
  })
}

type FileTreeMetaProps = useRender.ComponentProps<'span'>

function FileTreeMeta({ render, className, ...props }: FileTreeMetaProps) {
  const defaultProps: useRender.ElementProps<'span'> = {
    className: cn('min-w-0 shrink truncate system-xs-regular text-text-tertiary', className),
  }

  return useRender({
    defaultTagName: 'span',
    render,
    props: mergeProps<'span'>(defaultProps, props),
  })
}

type FileTreeBadgeProps = useRender.ComponentProps<'span'>

function FileTreeBadge({ render, className, ...props }: FileTreeBadgeProps) {
  const defaultProps: useRender.ElementProps<'span'> = {
    className: cn(
      'ms-1 inline-flex min-w-4 shrink-0 items-center justify-center rounded-[5px] border border-divider-deep bg-components-badge-bg-dimm px-1 py-0.5 system-2xs-medium-uppercase text-text-tertiary',
      className,
    ),
  }

  return useRender({
    defaultTagName: 'span',
    render,
    props: mergeProps<'span'>(defaultProps, props),
  })
}

export {
  FileTree,
  FileTreeBadge,
  FileTreeFile,
  FileTreeFolder,
  FileTreeFolderPanel,
  FileTreeFolderTrigger,
  FileTreeGuide,
  FileTreeIcon,
  FileTreeLabel,
  FileTreeList,
  FileTreeMeta,
}
export type {
  FileTreeBadgeProps,
  FileTreeFileProps,
  FileTreeFolderPanelProps,
  FileTreeFolderProps,
  FileTreeFolderTriggerProps,
  FileTreeGuideProps,
  FileTreeIconProps,
  FileTreeIconType,
  FileTreeLabelProps,
  FileTreeListProps,
  FileTreeMetaProps,
  FileTreeProps,
}
