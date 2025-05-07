import type { RemixiconComponentType } from '@remixicon/react'
import React from 'react'

type ItemProps = {
  Icon: RemixiconComponentType
  title: string
  description: string
  onClick: () => void
}

const Item = ({
  Icon,
  title,
  description,
  onClick,
}: ItemProps) => {
  return (
    <div
      className='group flex w-[337px] cursor-pointer items-center gap-x-3 rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-on-panel-item-bg p-4 shadow-xs shadow-shadow-shadow-3 hover:shadow-md hover:shadow-shadow-shadow-5'
      onClick={onClick}
    >
      <div className='flex size-10 shrink-0 items-center justify-center rounded-[10px] border border-dashed border-divider-regular bg-background-section group-hover:border-state-accent-hover-alt group-hover:bg-state-accent-hover'>
        <Icon className='size-5 text-text-quaternary group-hover:text-text-accent' />
      </div>
      <div className='flex grow flex-col gap-y-0.5 py-px'>
        <div className='system-md-semibold truncate text-text-secondary'>
          {title}
        </div>
        <div className='system-xs-regular text-text-tertiary'>
          {description}
        </div>
      </div>
    </div>
  )
}

export default React.memo(Item)
