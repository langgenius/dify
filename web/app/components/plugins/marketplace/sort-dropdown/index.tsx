'use client'
import { useTranslation } from '#i18n'
import {
  RiArrowDownSLine,
  RiCheckLine,
} from '@remixicon/react'
import { useState } from 'react'
import {
  PortalToFollowElem,
  PortalToFollowElemContent,
  PortalToFollowElemTrigger,
} from '@/app/components/base/portal-to-follow-elem'
import { useMarketplaceSort } from '../atoms'

const SortDropdown = () => {
  const { t } = useTranslation()
  const options = [
    {
      value: 'install_count',
      order: 'DESC',
      text: t('marketplace.sortOption.mostPopular', { ns: 'plugin' }),
    },
    {
      value: 'version_updated_at',
      order: 'DESC',
      text: t('marketplace.sortOption.recentlyUpdated', { ns: 'plugin' }),
    },
    {
      value: 'created_at',
      order: 'DESC',
      text: t('marketplace.sortOption.newlyReleased', { ns: 'plugin' }),
    },
    {
      value: 'created_at',
      order: 'ASC',
      text: t('marketplace.sortOption.firstReleased', { ns: 'plugin' }),
    },
  ]
  const [sort, handleSortChange] = useMarketplaceSort()
  const [open, setOpen] = useState(false)
  const selectedOption = options.find(option => option.value === sort.sortBy && option.order === sort.sortOrder) ?? options[0]

  return (
    <PortalToFollowElem
      placement="bottom-start"
      offset={{
        mainAxis: 4,
        crossAxis: 0,
      }}
      open={open}
      onOpenChange={setOpen}
    >
      <PortalToFollowElemTrigger onClick={() => setOpen(v => !v)}>
        <div className="flex h-8 cursor-pointer items-center rounded-lg bg-state-base-hover-alt px-2 pr-3">
          <span className="system-sm-regular mr-1 text-text-secondary">
            {t('marketplace.sortBy', { ns: 'plugin' })}
          </span>
          <span className="system-sm-medium mr-1 text-text-primary">
            {selectedOption.text}
          </span>
          <RiArrowDownSLine className="h-4 w-4 text-text-tertiary" />
        </div>
      </PortalToFollowElemTrigger>
      <PortalToFollowElemContent>
        <div className="rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-bg-blur p-1 shadow-lg backdrop-blur-sm">
          {
            options.map(option => (
              <div
                key={`${option.value}-${option.order}`}
                className="system-md-regular flex h-8 cursor-pointer items-center justify-between rounded-lg px-3 pr-2 text-text-primary hover:bg-components-panel-on-panel-item-bg-hover"
                onClick={() => handleSortChange({ sortBy: option.value, sortOrder: option.order })}
              >
                {option.text}
                {
                  sort.sortBy === option.value && sort.sortOrder === option.order && (
                    <RiCheckLine className="ml-2 h-4 w-4 text-text-accent" />
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
