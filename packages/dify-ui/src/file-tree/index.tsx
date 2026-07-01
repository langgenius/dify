'use client'

import { Collapsible as BaseCollapsible } from '@base-ui/react/collapsible'
import { mergeProps } from '@base-ui/react/merge-props'
import { useRender } from '@base-ui/react/use-render'
import * as React from 'react'
import { cn } from '../cn'

const FileTreeLevelContext = React.createContext(1)

function useFileTreeLevel() {
  return React.useContext(FileTreeLevelContext)
}

function getLabelText(children: React.ReactNode) {
  return typeof children === 'string' || typeof children === 'number'
    ? String(children)
    : undefined
}

function renderGuides(level: number) {
  return Array.from({ length: Math.max(level - 1, 0) }, (_, index) => (
    <FileTreeGuide key={index} />
  ))
}

type FileTreeRowState = {
  selected: boolean
  disabled: boolean
  level: number
}

function fileTreeRowClassName({
  className,
}: {
  className?: string
}) {
  return cn(
    'group/file-tree-row relative flex h-6 w-full min-w-0 cursor-pointer items-center rounded-md ps-2 pe-1.5 text-start outline-hidden select-none',
    'hover:bg-state-base-hover focus-visible:inset-ring-2 focus-visible:inset-ring-state-accent-solid',
    'data-[selected]:bg-state-base-active',
    'data-disabled:cursor-not-allowed data-disabled:opacity-50 data-disabled:hover:bg-transparent',
    'aria-disabled:cursor-not-allowed aria-disabled:opacity-50 aria-disabled:hover:bg-transparent',
    className,
  )
}

export type FileTreeRootProps = useRender.ComponentProps<'section'>

export function FileTreeRoot({
  render,
  className,
  children,
  ...props
}: FileTreeRootProps) {
  const defaultProps: useRender.ElementProps<'section'> = {
    className: cn('flex min-w-0 flex-col gap-px p-1', className),
    children: (
      <FileTreeLevelContext.Provider value={1}>
        {children}
      </FileTreeLevelContext.Provider>
    ),
  }

  return useRender({
    defaultTagName: 'section',
    render,
    props: mergeProps<'section'>(defaultProps, props),
  })
}

export type FileTreeListProps = useRender.ComponentProps<'ul'>

export function FileTreeList({
  render,
  className,
  ...props
}: FileTreeListProps) {
  const defaultProps: useRender.ElementProps<'ul'> = {
    className: cn('m-0 flex min-w-0 list-none flex-col gap-px p-0', className),
  }

  return useRender({
    defaultTagName: 'ul',
    render,
    props: mergeProps<'ul'>(defaultProps, props),
  })
}

export type FileTreeFolderProps
  = Omit<BaseCollapsible.Root.Props, 'render'>
    & {
      render?: BaseCollapsible.Root.Props['render']
    }

export function FileTreeFolder({
  render = <li />,
  className,
  ...props
}: FileTreeFolderProps) {
  return (
    <BaseCollapsible.Root
      render={render}
      className={cn('min-w-0', className)}
      {...props}
    />
  )
}

export type FileTreeFolderTriggerProps
  = Omit<BaseCollapsible.Trigger.Props, 'className'>
    & {
      className?: string
      level?: number
    }

export function FileTreeFolderTrigger({
  className,
  children,
  disabled,
  level: levelProp,
  ...props
}: FileTreeFolderTriggerProps) {
  const contextLevel = useFileTreeLevel()
  const level = levelProp ?? contextLevel

  return (
    <BaseCollapsible.Trigger
      className={fileTreeRowClassName({ className })}
      disabled={disabled}
      data-disabled={disabled || undefined}
      {...props}
    >
      {renderGuides(level)}
      <div className="flex min-w-0 flex-[1_0_0] items-center py-0.5">
        {children}
      </div>
    </BaseCollapsible.Trigger>
  )
}

export type FileTreeFolderPanelProps
  = Omit<BaseCollapsible.Panel.Props, 'render'>
    & {
      render?: BaseCollapsible.Panel.Props['render']
    }

export function FileTreeFolderPanel({
  render = <ul />,
  className,
  children,
  ...props
}: FileTreeFolderPanelProps) {
  const level = useFileTreeLevel()

  return (
    <BaseCollapsible.Panel
      render={render}
      className={cn('m-0 flex min-w-0 list-none flex-col gap-px p-0', className)}
      {...props}
    >
      <FileTreeLevelContext.Provider value={level + 1}>
        {children}
      </FileTreeLevelContext.Provider>
    </BaseCollapsible.Panel>
  )
}

export type FileTreeFileProps
  = Omit<useRender.ComponentProps<'button', FileTreeRowState>, 'type'>
    & {
      level?: number
      selected?: boolean
    }

export function FileTreeFile({
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
  const state: FileTreeRowState = {
    selected,
    disabled,
    level,
  }
  const defaultProps = {
    'type': 'button',
    'disabled': disabled,
    'data-selected': selected || undefined,
    'data-disabled': disabled || undefined,
    'aria-current': selected ? 'true' : undefined,
    'className': fileTreeRowClassName({ className }),
    'children': (
      <React.Fragment>
        {renderGuides(level)}
        <div className="flex min-w-0 flex-[1_0_0] items-center py-0.5">
          {children}
        </div>
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

export type FileTreeGuideProps = useRender.ComponentProps<'span'>

export function FileTreeGuide({
  render,
  className,
  ...props
}: FileTreeGuideProps) {
  const defaultProps: useRender.ElementProps<'span'> = {
    'aria-hidden': true,
    'className': cn(
      'relative h-6 w-5 shrink-0 before:absolute before:bottom-[-1px] before:left-1/2 before:top-0 before:w-px before:-translate-x-1/2 before:bg-divider-subtle',
      className,
    ),
  }

  return useRender({
    defaultTagName: 'span',
    render,
    props: mergeProps<'span'>(defaultProps, props),
  })
}

export type FileTreeIconType
  = 'folder'
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

export type FileTreeIconProps
  = Omit<useRender.ComponentProps<'span'>, 'children'>
    & {
      type?: FileTreeIconType
      children?: React.ReactNode
    }

export function FileTreeIcon({
  type = 'file',
  render,
  className,
  children,
  ...props
}: FileTreeIconProps) {
  const defaultProps: useRender.ElementProps<'span'> = {
    'aria-hidden': true,
    'className': cn('relative flex size-5 shrink-0 items-center justify-center text-text-secondary', className),
    'children': (
      <React.Fragment>
        {children ?? (
          type === 'folder'
            ? (
                <React.Fragment>
                  <span className="size-4 i-ri-folder-line group-data-panel-open/file-tree-row:hidden" />
                  <span className="hidden size-4 text-text-accent i-ri-folder-open-line group-data-panel-open/file-tree-row:block" />
                </React.Fragment>
              )
            : <span className={cn('size-4', fileTreeIconClassNames[type])} />
        )}
      </React.Fragment>
    ),
  }

  return useRender({
    defaultTagName: 'span',
    render,
    props: mergeProps<'span'>(defaultProps, props),
  })
}

export type FileTreeLabelProps = useRender.ComponentProps<'span'>
type FileTreeLabelElementProps = useRender.ElementProps<'span'> & {
  'data-label'?: string
}

export function FileTreeLabel({
  render,
  className,
  children,
  ...props
}: FileTreeLabelProps) {
  const labelText = getLabelText(children)
  const defaultProps = {
    'data-label': labelText,
    'className': cn(
      'min-w-0 truncate rounded-[5px] px-1 py-0.5',
      labelText && 'after:invisible after:block after:h-0 after:overflow-hidden after:system-sm-medium after:content-[attr(data-label)]',
      'system-sm-regular text-text-secondary group-data-[selected]/file-tree-row:system-sm-medium group-data-[selected]/file-tree-row:text-text-primary',
      className,
    ),
    children,
  } satisfies FileTreeLabelElementProps

  return useRender({
    defaultTagName: 'span',
    render,
    props: mergeProps<'span'>(defaultProps, props),
  })
}

export type FileTreeMetaProps = useRender.ComponentProps<'span'>

export function FileTreeMeta({
  render,
  className,
  ...props
}: FileTreeMetaProps) {
  const defaultProps: useRender.ElementProps<'span'> = {
    className: cn('min-w-0 shrink truncate system-xs-regular text-text-tertiary', className),
  }

  return useRender({
    defaultTagName: 'span',
    render,
    props: mergeProps<'span'>(defaultProps, props),
  })
}

export type FileTreeBadgeProps = useRender.ComponentProps<'span'>

export function FileTreeBadge({
  render,
  className,
  ...props
}: FileTreeBadgeProps) {
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
