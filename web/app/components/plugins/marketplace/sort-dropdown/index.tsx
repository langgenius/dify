'use client'
import { useTranslation } from '#i18n'
import { useState } from 'react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/app/components/base/ui/dropdown-menu'
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
  const selectedOption = options.find(option => option.value === sort.sortBy && option.order === sort.sortOrder) ?? options[0]!

  return (
    <DropdownMenu
      open={open}
      onOpenChange={setOpen}
    >
      <DropdownMenuTrigger className="flex h-8 cursor-pointer items-center rounded-lg bg-state-base-hover-alt px-2 pr-3">
        <span className="mr-1 system-sm-regular text-text-secondary">
          {t('marketplace.sortBy', { ns: 'plugin' })}
        </span>
        <span className="mr-1 system-sm-medium text-text-primary">
          {selectedOption.text}
        </span>
        <span aria-hidden className="i-ri-arrow-down-s-line h-4 w-4 text-text-tertiary" />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        placement="bottom-start"
        sideOffset={4}
        popupClassName="p-1"
      >
        {options.map(option => (
          <DropdownMenuItem
            key={`${option.value}-${option.order}`}
            className="justify-between px-3 pr-2 system-md-regular text-text-primary"
            onClick={() => {
              handleSortChange({ sortBy: option.value, sortOrder: option.order })
              setOpen(false)
            }}
          >
            {option.text}
            {sort.sortBy === option.value && sort.sortOrder === option.order && (
              <span aria-hidden className="ml-2 i-ri-check-line h-4 w-4 text-text-accent" />
            )}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export default SortDropdown
