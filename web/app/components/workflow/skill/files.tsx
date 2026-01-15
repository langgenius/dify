'use client'
import type { FC, ReactNode } from 'react'
import type { ParentId, ResourceItem, ResourceItemList } from './type'
import { RiDragDropLine } from '@remixicon/react'
import * as React from 'react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import FileItem from './file-item'
import FoldItem from './fold-item'
import { ResourceKind, SKILL_ROOT_ID } from './type'

const TreeIndent = ({ depth }: { depth: number }) => {
  if (depth <= 0)
    return null

  return (
    <div className="flex h-full items-stretch">
      {Array.from({ length: depth }).map((_, index) => (
        <span key={index} className="relative w-5 shrink-0">
          <span className="absolute left-1/2 top-0 h-full w-px bg-components-panel-border-subtle" />
        </span>
      ))}
    </div>
  )
}

type FilesProps = {
  items: ResourceItemList
  activeItemId?: string
}

const buildChildrenMap = (items: ResourceItemList) => {
  const map = new Map<ParentId, ResourceItem[]>()
  items.forEach((item) => {
    const parentId = item.parent_id ?? null
    const existing = map.get(parentId)
    if (existing)
      existing.push(item)
    else
      map.set(parentId, [item])
  })
  return map
}

const Files: FC<FilesProps> = ({ items, activeItemId }) => {
  const { t } = useTranslation()
  const childrenMap = useMemo(() => buildChildrenMap(items), [items])

  const renderNodes = (parentId: ParentId, depth: number): ReactNode[] => {
    const children = childrenMap.get(parentId) || []

    return children.flatMap((item) => {
      const prefix = <TreeIndent depth={depth} />
      const isActive = item.id === activeItemId
      const nodes: ReactNode[] = []

      if (item.kind === ResourceKind.folder) {
        nodes.push(
          <FoldItem
            key={item.id}
            name={item.name}
            prefix={prefix}
            active={isActive}
            open
          />,
        )
        nodes.push(...renderNodes(item.id, depth + 1))
      }
      else {
        nodes.push(
          <FileItem
            key={item.id}
            name={item.name}
            prefix={prefix}
            active={isActive}
          />,
        )
      }

      return nodes
    })
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-0 flex-1 flex-col gap-px overflow-auto px-1 pb-0 pt-1">
        {renderNodes(SKILL_ROOT_ID, 0)}
      </div>
      <div className="flex items-center justify-center gap-2 py-4 text-text-quaternary">
        <RiDragDropLine className="size-4" />
        <span className="system-xs-regular">
          {t('skillSidebar.dropTip', { ns: 'workflow' })}
        </span>
      </div>
    </div>
  )
}

export default React.memo(Files)
