'use client'

import type { Tag } from '../../hooks'
import { useTranslation } from '#i18n'
import { RiArrowDownSLine, RiCloseCircleFill, RiPriceTag3Line } from '@remixicon/react'
import * as React from 'react'
import { cn } from '@/utils/classnames'

type HeroTagsTriggerProps = {
  selectedTagsLength: number
  open: boolean
  tags: string[]
  tagsMap: Record<string, Tag>
  onTagsChange: (tags: string[]) => void
}

const HeroTagsTrigger = ({
  selectedTagsLength,
  open,
  tags,
  tagsMap,
  onTagsChange,
}: HeroTagsTriggerProps) => {
  const { t } = useTranslation()
  const hasSelected = !!selectedTagsLength

  return (
    <div
      className={cn(
        'flex h-8 cursor-pointer select-none items-center gap-1.5 rounded-lg px-2.5 py-1.5',
        !hasSelected && 'border border-white/30 text-text-primary-on-surface',
        !hasSelected && open && 'bg-state-base-hover',
        !hasSelected && !open && 'hover:bg-state-base-hover',
        hasSelected && 'border-effect-highlight border bg-components-button-secondary-bg-hover shadow-md backdrop-blur-[5px]',
      )}
    >
      <RiPriceTag3Line className={cn(
        'size-4 shrink-0',
        hasSelected ? 'text-saas-dify-blue-inverted' : 'text-text-primary-on-surface',
      )}
      />
      <div className="system-md-medium flex items-center gap-0.5">
        {
          !hasSelected && (
            <span>{t('allTags', { ns: 'pluginTags' })}</span>
          )
        }
        {
          hasSelected && (
            <span className="text-saas-dify-blue-inverted">
              {tags.map(tag => tagsMap[tag]?.label).filter(Boolean).slice(0, 2).join(', ')}
            </span>
          )
        }
        {
          selectedTagsLength > 2 && (
            <div className="flex min-w-4 items-center justify-center rounded-[5px] border border-saas-dify-blue-inverted px-1 py-0.5">
              <span className="system-2xs-medium-uppercase text-saas-dify-blue-inverted">
                +
                {selectedTagsLength - 2}
              </span>
            </div>
          )
        }
      </div>
      {
        hasSelected && (
          <RiCloseCircleFill
            className="size-4 shrink-0 text-saas-dify-blue-inverted"
            onClick={(e) => {
              e.stopPropagation()
              onTagsChange([])
            }}
          />
        )
      }
      {
        !hasSelected && (
          <RiArrowDownSLine className="size-4 shrink-0 text-text-primary-on-surface" />
        )
      }
    </div>
  )
}

export default React.memo(HeroTagsTrigger)
