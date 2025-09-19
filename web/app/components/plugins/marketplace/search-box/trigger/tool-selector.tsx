import React from 'react'
import type { Tag } from '../../../hooks'
import cn from '@/utils/classnames'
import { RiCloseCircleFill, RiPriceTag3Line } from '@remixicon/react'

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
      'flex h-7 cursor-pointer select-none items-center rounded-md p-0.5 text-text-tertiary',
      !selectedTagsLength && 'py-1 pl-1.5 pr-2',
      !!selectedTagsLength && 'border-[0.5px] border-components-button-secondary-border bg-components-button-secondary-bg py-0.5 pl-1 pr-1.5 shadow-xs shadow-shadow-shadow-3',
      open && !selectedTagsLength && 'bg-state-base-hover',
    )}
    >
      <div className='p-0.5'>
        <RiPriceTag3Line className={cn('size-4', !!selectedTagsLength && 'text-text-secondary')} />
      </div>
      {
        !!selectedTagsLength && (
          <div className='system-sm-medium flex items-center gap-x-0.5 px-0.5 py-1'>
            <span className='text-text-secondary'>
              {tags.map(tag => tagsMap[tag].label).slice(0, 2).join(',')}
            </span>
            {
              selectedTagsLength > 2 && (
                <div className='system-xs-medium text-text-tertiary'>
                  +{selectedTagsLength - 2}
                </div>
              )
            }
          </div>
        )
      }
      {
        !!selectedTagsLength && (
          <RiCloseCircleFill
            className='size-4 text-text-quaternary'
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
