'use client'
import type { FC } from 'react'
import React, { useCallback } from 'react'
import { RiNodeTree, RiSortAlphabetAsc } from '@remixicon/react'
import cn from '@/utils/classnames'

export enum ViewType {
  flat = 'flat',
  tree = 'tree',
}

type Props = {
  viewType: ViewType
  onChange: (viewType: ViewType) => void
}

const ViewTypeSelect: FC<Props> = ({
  viewType,
  onChange,
}) => {
  const handleChange = useCallback((nextViewType: ViewType) => {
    return () => {
      if (nextViewType === viewType)
        return
      onChange(nextViewType)
    }
  }, [viewType, onChange])

  return (
    <div className='flex items-center rounded-lg bg-components-segmented-control-bg-normal p-px'>
      <div
        className={
          cn('p-[3px] rounded-lg',
            viewType === ViewType.flat
              ? 'bg-components-segmented-control-item-active-bg shadow-xs text-text-accent-light-mode-only'
              : 'text-text-tertiary cursor-pointer',
          )
        }
        onClick={handleChange(ViewType.flat)}
      >
        <RiSortAlphabetAsc className='w-4 h-4' />
      </div>
      <div
        className={
          cn('p-[3px] rounded-lg',
            viewType === ViewType.tree
              ? 'bg-components-segmented-control-item-active-bg shadow-xs text-text-accent-light-mode-only'
              : 'text-text-tertiary cursor-pointer',
          )
        }
        onClick={handleChange(ViewType.tree)}
      >
        <RiNodeTree className='w-4 h-4 ' />
      </div>
    </div>
  )
}
export default React.memo(ViewTypeSelect)
