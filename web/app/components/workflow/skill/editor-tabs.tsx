import type { FC } from 'react'
import type { SkillTabItem } from './mock-data'
import * as React from 'react'
import { cn } from '@/utils/classnames'
import EditorTabItem from './editor-tab-item'

type EditorTabsProps = {
  items: SkillTabItem[]
}

const EditorTabs: FC<EditorTabsProps> = ({ items }) => {
  return (
    <div
      className={cn(
        'flex items-center overflow-hidden rounded-t-lg border-b border-components-panel-border-subtle bg-components-panel-bg-alt',
      )}
    >
      {items.map(item => (
        <EditorTabItem key={item.id} item={item} />
      ))}
    </div>
  )
}

export default React.memo(EditorTabs)
