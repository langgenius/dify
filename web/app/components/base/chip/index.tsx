import type { FC } from 'react'
import { useMemo, useState } from 'react'
import { RiArrowDownSLine, RiCheckLine, RiCloseCircleFill, RiFilter3Line } from '@remixicon/react'
import cn from '@/utils/classnames'
import {
  PortalToFollowElem,
  PortalToFollowElemContent,
  PortalToFollowElemTrigger,
} from '@/app/components/base/portal-to-follow-elem'

export type Item = {
  value: number | string
  name: string
} & Record<string, any>

type Props = {
  className?: string
  panelClassName?: string
  showLeftIcon?: boolean
  leftIcon?: any
  value: number | string
  items: Item[]
  onSelect: (item: any) => void
  onClear: () => void
}
const Chip: FC<Props> = ({
  className,
  panelClassName,
  showLeftIcon = true,
  leftIcon,
  value,
  items,
  onSelect,
  onClear,
}) => {
  const [open, setOpen] = useState(false)

  const triggerContent = useMemo(() => {
    return items.find(item => item.value === value)?.name || ''
  }, [items, value])

  return (
    <PortalToFollowElem
      open={open}
      onOpenChange={setOpen}
      placement='bottom-start'
      offset={4}
    >
      <div className='relative'>
        <PortalToFollowElemTrigger
          onClick={() => setOpen(v => !v)}
          className='block'
        >
          <div className={cn(
            'bg-components-input-bg-normal hover:bg-state-base-hover-alt flex min-h-8 cursor-pointer items-center rounded-lg border-[0.5px] border-transparent px-2 py-1',
            open && !value && '!bg-state-base-hover-alt hover:bg-state-base-hover-alt',
            !open && !!value && '!bg-components-button-secondary-bg shadow-xs !border-components-button-secondary-border hover:!bg-components-button-secondary-bg-hover hover:border-components-button-secondary-border-hover',
            open && !!value && '!bg-components-button-secondary-bg-hover !border-components-button-secondary-border-hover shadow-xs hover:!bg-components-button-secondary-bg-hover hover:border-components-button-secondary-border-hover',
            className,
          )}>
            {showLeftIcon && (
              <div className='p-0.5'>
                {leftIcon || (
                  <RiFilter3Line className={cn('text-text-tertiary h-4 w-4', !!value && 'text-text-secondary')} />
                )}
              </div>
            )}
            <div className='flex grow items-center gap-0.5 first-line:p-1'>
              <div className={cn('system-sm-regular text-text-tertiary', !!value && 'text-text-secondary')}>
                {triggerContent}
              </div>
            </div>
            {!value && <RiArrowDownSLine className='text-text-tertiary h-4 w-4' />}
            {!!value && (
              <div className='group/clear cursor-pointer p-[1px]' onClick={(e) => {
                e.stopPropagation()
                onClear()
              }}>
                <RiCloseCircleFill className='text-text-quaternary group-hover/clear:text-text-tertiary h-3.5 w-3.5' />
              </div>
            )}
          </div>
        </PortalToFollowElemTrigger>
        <PortalToFollowElemContent className='z-[1002]'>
          <div className={cn('bg-components-panel-bg-blur border-components-panel-border relative w-[240px] rounded-xl border-[0.5px] shadow-lg', panelClassName)}>
            <div className='max-h-72 overflow-auto p-1'>
              {items.map(item => (
                <div
                  key={item.value}
                  className='hover:bg-state-base-hover flex cursor-pointer items-center gap-2 rounded-lg px-2 py-[6px] pl-3'
                  onClick={() => {
                    onSelect(item)
                    setOpen(false)
                  }}
                >
                  <div title={item.name} className='text-text-secondary system-sm-medium grow truncate'>{item.name}</div>
                  {value === item.value && <RiCheckLine className='text-util-colors-blue-light-blue-light-600 h-4 w-4 shrink-0' />}
                </div>
              ))}
            </div>
          </div>
        </PortalToFollowElemContent>
      </div>
    </PortalToFollowElem>

  )
}

export default Chip
