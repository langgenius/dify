import React from 'react'
import Item from './item'

type MenuProps = {
  breadcrumbs: string[]
  startIndex: number
  onBreadcrumbClick: (index: number) => void
}

const Menu = ({
  breadcrumbs,
  startIndex,
  onBreadcrumbClick,
}: MenuProps) => {
  return (
    <div className='flex w-[136px] flex-col rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-bg-blur p-1 shadow-lg shadow-shadow-shadow-5 backdrop-blur-[5px]'>
      {breadcrumbs.map((breadcrumb, index) => {
        return (
          <Item
            key={`${breadcrumb}-${index}`}
            name={breadcrumb}
            index={startIndex + index}
            onBreadcrumbClick={onBreadcrumbClick}
          />
        )
      })}
    </div>
  )
}

export default React.memo(Menu)
