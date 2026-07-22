'use client'

import { cn } from '@langgenius/dify-ui/cn'
import { Popover, PopoverContent, PopoverTrigger } from '@langgenius/dify-ui/popover'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

export type AgentVersionFilter = 'all' | 'onlyYours'

function FilterItem({
  label,
  selected,
  onClick,
}: {
  label: string
  selected: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full cursor-pointer items-center justify-between gap-x-1 rounded-lg px-2 py-1.5 text-left hover:bg-state-base-hover focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden"
    >
      <span className="min-w-0 flex-1 truncate system-md-regular text-text-primary">{label}</span>
      {selected && (
        <span aria-hidden className="i-ri-check-line size-4 shrink-0 text-text-accent" />
      )}
    </button>
  )
}

export function VersionFilter({
  filterValue,
  onFilterChange,
}: {
  filterValue: AgentVersionFilter
  onFilterChange: (filterValue: AgentVersionFilter) => void
}) {
  const { t } = useTranslation('agentV2')
  const { t: tWorkflow } = useTranslation('workflow')
  const [open, setOpen] = useState(false)
  const isFiltering = filterValue !== 'all'

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        nativeButton={false}
        render={
          <button
            type="button"
            aria-label={t(($) => $['agentDetail.versionHistory.filter'])}
            className={cn(
              'flex size-6 shrink-0 items-center justify-center rounded-md p-0.5 focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden',
              isFiltering
                ? 'bg-state-accent-active-alt text-text-accent'
                : 'text-text-tertiary hover:bg-state-base-hover hover:text-text-secondary',
            )}
          >
            <span aria-hidden className="i-ri-filter-3-line size-4" />
          </button>
        }
      />
      <PopoverContent
        placement="bottom-end"
        sideOffset={4}
        alignOffset={55}
        popupClassName="border-none bg-transparent shadow-none"
      >
        <div className="flex w-[248px] flex-col rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-bg-blur shadow-lg shadow-shadow-shadow-5 backdrop-blur-[5px]">
          <div className="flex flex-col p-1">
            <FilterItem
              label={tWorkflow(($) => $['versionHistory.filter.all'])}
              selected={filterValue === 'all'}
              onClick={() => onFilterChange('all')}
            />
            <FilterItem
              label={tWorkflow(($) => $['versionHistory.filter.onlyYours'])}
              selected={filterValue === 'onlyYours'}
              onClick={() => onFilterChange('onlyYours')}
            />
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}
