import type { FC } from 'react'
import { RiFilter3Line } from '@remixicon/react'
import * as React from 'react'
import { useCallback, useState } from 'react'
import Divider from '@/app/components/base/divider'
import {
  PortalToFollowElem,
  PortalToFollowElemContent,
  PortalToFollowElemTrigger,
} from '@/app/components/base/portal-to-follow-elem'
import { cn } from '@/utils/classnames'
import { WorkflowVersionFilterOptions } from '../../../types'
import FilterItem from './filter-item'
import FilterSwitch from './filter-switch'
import { useFilterOptions } from './use-filter'

type FilterProps = {
  filterValue: WorkflowVersionFilterOptions
  isOnlyShowNamedVersions: boolean
  onClickFilterItem: (filter: WorkflowVersionFilterOptions) => void
  handleSwitch: (isOnlyShowNamedVersions: boolean) => void
}

const Filter: FC<FilterProps> = ({
  filterValue,
  isOnlyShowNamedVersions,
  onClickFilterItem,
  handleSwitch,
}) => {
  const [open, setOpen] = useState(false)
  const options = useFilterOptions()

  const handleOnClick = useCallback((value: WorkflowVersionFilterOptions) => {
    onClickFilterItem(value)
  }, [onClickFilterItem])

  const isFiltering = filterValue !== WorkflowVersionFilterOptions.all || isOnlyShowNamedVersions

  return (
    <PortalToFollowElem
      placement="bottom-end"
      offset={{
        mainAxis: 4,
        crossAxis: 55,
      }}
      open={open}
      onOpenChange={setOpen}
    >
      <PortalToFollowElemTrigger onClick={() => setOpen(v => !v)}>
        <div
          className={cn(
            'flex h-6 w-6 cursor-pointer items-center justify-center rounded-md p-0.5',
            isFiltering ? 'bg-state-accent-active-alt' : 'hover:bg-state-base-hover',
          )}
        >
          <RiFilter3Line className={cn('h-4 w-4', isFiltering ? 'text-text-accent' : ' text-text-tertiary')} />
        </div>
      </PortalToFollowElemTrigger>
      <PortalToFollowElemContent className="z-[12]">
        <div className="flex w-[248px] flex-col rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-bg-blur shadow-lg shadow-shadow-shadow-5 backdrop-blur-[5px]">
          <div className="flex flex-col p-1">
            {
              options.map((option) => {
                return (
                  <FilterItem
                    key={option.key}
                    item={option}
                    isSelected={filterValue === option.key}
                    onClick={handleOnClick}
                  />
                )
              })
            }
          </div>
          <Divider type="horizontal" className="my-0 h-px bg-divider-subtle" />
          <FilterSwitch enabled={isOnlyShowNamedVersions} handleSwitch={handleSwitch} />
        </div>
      </PortalToFollowElemContent>
    </PortalToFollowElem>
  )
}

export default Filter
