import React from 'react'
import { RiArrowDownSLine, RiCloseCircleFill, RiFilter3Line } from '@remixicon/react'
import type { Tag } from '../../../hooks'
import cn from '@/utils/classnames'
import { useMixedTranslation } from '../../hooks'

type MarketplaceTriggerProps = {
  selectedTagsLength: number
  open: boolean
  tags: string[]
  tagsMap: Record<string, Tag>
  locale?: string
  onTagsChange: (tags: string[]) => void
}

const MarketplaceTrigger = ({
  selectedTagsLength,
  open,
  tags,
  tagsMap,
  locale,
  onTagsChange,
}: MarketplaceTriggerProps) => {
  const { t } = useMixedTranslation(locale)

  return (
    <div
      className={cn(
        'flex h-8 cursor-pointer select-none items-center rounded-lg px-2 py-1 text-text-tertiary',
        !!selectedTagsLength && 'border-[0.5px] border-components-button-secondary-border bg-components-button-secondary-bg shadow-xs shadow-shadow-shadow-3',
        open && !selectedTagsLength && 'bg-state-base-hover',
      )}
    >
      <div className='p-0.5'>
        <RiFilter3Line className={cn('size-4', !!selectedTagsLength && 'text-text-secondary')} />
      </div>
      <div className='system-sm-medium flex items-center gap-x-1 p-1'>
        {
          !selectedTagsLength && <span>{t('pluginTags.allTags')}</span>
        }
        {
          !!selectedTagsLength && (
            <span className='text-text-secondary'>
              {tags.map(tag => tagsMap[tag].label).slice(0, 2).join(',')}
            </span>
          )
        }
        {
          selectedTagsLength > 2 && (
            <div className='system-xs-medium text-text-tertiary'>
              +{selectedTagsLength - 2}
            </div>
          )
        }
      </div>
      {
        !!selectedTagsLength && (
          <RiCloseCircleFill
            className='size-4 text-text-quaternary'
            onClick={() => onTagsChange([])}
          />
        )
      }
      {
        !selectedTagsLength && (
          <div className='p-0.5'>
            <RiArrowDownSLine className='size-4 text-text-tertiary' />
          </div>
        )
      }
    </div>
  )
}

export default React.memo(MarketplaceTrigger)
