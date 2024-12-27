'use client'
import { useState } from 'react'
import {
  RiArrowDownSLine,
  RiCheckLine,
} from '@remixicon/react'
import { useMarketplaceContext } from '../context'
import {
  PortalToFollowElem,
  PortalToFollowElemContent,
  PortalToFollowElemTrigger,
} from '@/app/components/base/portal-to-follow-elem'
import { useMixedTranslation } from '@/app/components/plugins/marketplace/hooks'

type SortDropdownProps = {
  locale?: string
}
const SortDropdown = ({
  locale,
}: SortDropdownProps) => {
  const { t } = useMixedTranslation(locale)
  const options = [
    {
      value: 'install_count',
      order: 'DESC',
      text: t('plugin.marketplace.sortOption.mostPopular'),
    },
    {
      value: 'version_updated_at',
      order: 'DESC',
      text: t('plugin.marketplace.sortOption.recentlyUpdated'),
    },
    {
      value: 'created_at',
      order: 'DESC',
      text: t('plugin.marketplace.sortOption.newlyReleased'),
    },
    {
      value: 'created_at',
      order: 'ASC',
      text: t('plugin.marketplace.sortOption.firstReleased'),
    },
  ]
  const sort = useMarketplaceContext(v => v.sort)
  const handleSortChange = useMarketplaceContext(v => v.handleSortChange)
  const [open, setOpen] = useState(false)
  const selectedOption = options.find(option => option.value === sort.sortBy && option.order === sort.sortOrder)!

  return (
    <PortalToFollowElem
      placement='bottom-start'
      offset={{
        mainAxis: 4,
        crossAxis: 0,
      }}
      open={open}
      onOpenChange={setOpen}
    >
      <PortalToFollowElemTrigger onClick={() => setOpen(v => !v)}>
        <div className='flex items-center px-2 pr-3 h-8 rounded-lg bg-state-base-hover-alt cursor-pointer'>
          <span className='mr-1 system-sm-regular text-text-secondary'>
            {t('plugin.marketplace.sortBy')}
          </span>
          <span className='mr-1 system-sm-medium text-text-primary'>
            {selectedOption.text}
          </span>
          <RiArrowDownSLine className='w-4 h-4 text-text-tertiary' />
        </div>
      </PortalToFollowElemTrigger>
      <PortalToFollowElemContent>
        <div className='p-1 rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-bg-blur backdrop-blur-sm shadow-lg'>
          {
            options.map(option => (
              <div
                key={`${option.value}-${option.order}`}
                className='flex items-center justify-between px-3 pr-2 h-8 cursor-pointer system-md-regular text-text-primary rounded-lg hover:bg-components-panel-on-panel-item-bg-hover'
                onClick={() => handleSortChange({ sortBy: option.value, sortOrder: option.order })}
              >
                {option.text}
                {
                  sort.sortBy === option.value && sort.sortOrder === option.order && (
                    <RiCheckLine className='ml-2 w-4 h-4 text-text-accent' />
                  )
                }
              </div>
            ))
          }
        </div>
      </PortalToFollowElemContent>
    </PortalToFollowElem>
  )
}

export default SortDropdown
