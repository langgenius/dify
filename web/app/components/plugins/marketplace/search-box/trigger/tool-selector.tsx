import type { Tag } from '../../../hooks'
import { cn } from '@langgenius/dify-ui/cn'
import { RiCloseCircleFill, RiPriceTag3Line } from '@remixicon/react'
import * as React from 'react'

type ToolSelectorTriggerProps = {
  selectedTagsLength: number
  open: boolean
  tags: string[]
  tagsMap: Record<string, Tag>
  onTagsChange: (tags: string[]) => void
}

const ToolSelectorTrigger = ({
  selectedTagsLength,
  open,
  tags,
  tagsMap,
  onTagsChange,
}: ToolSelectorTriggerProps) => {
  return (
    <div className={cn(
      'flex h-7 cursor-pointer items-center rounded-md p-0.5 text-text-tertiary select-none',
      !selectedTagsLength && 'py-1 pr-2 pl-1.5',
      !!selectedTagsLength && 'border-[0.5px] border-components-button-secondary-border bg-components-button-secondary-bg py-0.5 pr-1.5 pl-1 shadow-xs shadow-shadow-shadow-3',
      open && !selectedTagsLength && 'bg-state-base-hover',
    )}
    >
      <div className="p-0.5">
        <RiPriceTag3Line className={cn('size-4', !!selectedTagsLength && 'text-text-secondary')} />
      </div>
      {
        !!selectedTagsLength && (
          <div className="flex items-center gap-x-0.5 px-0.5 py-1 system-sm-medium">
            <span className="text-text-secondary">
              {tags.map(tag => tagsMap[tag]!.label).slice(0, 2).join(',')}
            </span>
            {
              selectedTagsLength > 2 && (
                <div className="system-xs-medium text-text-tertiary">
                  +
                  {selectedTagsLength - 2}
                </div>
              )
            }
          </div>
        )
      }
      {
        !!selectedTagsLength && (
          <RiCloseCircleFill
            className="size-4 text-text-quaternary"
            onClick={(e) => {
              e.stopPropagation()
              onTagsChange([])
            }}
          />
        )
      }
    </div>
  )
}

export default React.memo(ToolSelectorTrigger)
