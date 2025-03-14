import { PortalToFollowElem, PortalToFollowElemContent, PortalToFollowElemTrigger } from '@/app/components/base/portal-to-follow-elem'
import type { ArrayType, Type } from '../../../../types'
import type { FC } from 'react'
import { useState } from 'react'
import { RiArrowDownSLine, RiCheckLine } from '@remixicon/react'
import cn from '@/utils/classnames'

export type TypeItem = {
  value: Type | ArrayType
  text: string
}

type TypeSelectorProps = {
  items: TypeItem[]
  currentValue: Type | ArrayType
  onSelect: (item: TypeItem) => void
  popupClassName?: string
}

const TypeSelector: FC<TypeSelectorProps> = ({
  items,
  currentValue,
  onSelect,
  popupClassName,
}) => {
  const [open, setOpen] = useState(false)

  return (
    <PortalToFollowElem
      open={open}
      onOpenChange={setOpen}
      placement='bottom-start'
      offset={{
        mainAxis: 4,
      }}
    >
      <PortalToFollowElemTrigger onClick={() => setOpen(v => !v)}>
        <div className={cn(
          'flex items-center p-0.5 pl-1 rounded-[5px] hover:bg-state-base-hover',
          open && 'bg-state-base-hover',
        )}>
          <span className='text-text-tertiary system-xs-medium'>{currentValue}</span>
          <RiArrowDownSLine className='w-4 h-4 text-text-tertiary' />
        </div>
      </PortalToFollowElemTrigger>
      <PortalToFollowElemContent className={popupClassName}>
        <div className='w-40 p-1 rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-bg shadow-lg shadow-shadow-shadow-5'>
          {items.map((item) => {
            const isSelected = item.value === currentValue
            return (<div
              key={item.value}
              className={'flex items-center gap-x-1 px-2 py-1 rounded-lg hover:bg-state-base-hover'}
              onClick={() => {
                onSelect(item)
                setOpen(false)
              }}
            >
              <span className='px-1 text-text-secondary system-sm-medium'>{item.text}</span>
              {isSelected && <RiCheckLine className='w-4 h-4 text-text-accent' />}
            </div>
            )
          })}
        </div>
      </PortalToFollowElemContent>
    </PortalToFollowElem>
  )
}

export default TypeSelector
