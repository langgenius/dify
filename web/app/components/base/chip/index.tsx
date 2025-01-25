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
            'flex items-center min-h-8 px-2 py-1 rounded-lg border-[0.5px] border-transparent bg-components-input-bg-normal cursor-pointer hover:bg-state-base-hover-alt',
            open && !value && '!bg-state-base-hover-alt hover:bg-state-base-hover-alt',
            !open && !!value && '!bg-components-button-secondary-bg shadow-xs !border-components-button-secondary-border hover:!bg-components-button-secondary-bg-hover hover:border-components-button-secondary-border-hover',
            open && !!value && '!bg-components-button-secondary-bg-hover !border-components-button-secondary-border-hover shadow-xs hover:!bg-components-button-secondary-bg-hover hover:border-components-button-secondary-border-hover',
            className,
          )}>
            {showLeftIcon && (
              <div className='p-0.5'>
                {leftIcon || (
                  <RiFilter3Line className={cn('h-4 w-4 text-text-tertiary', !!value && 'text-text-secondary')} />
                )}
              </div>
            )}
            <div className='grow first-line:p-1 flex items-center gap-0.5'>
              <div className={cn('system-sm-regular text-text-tertiary', !!value && 'text-text-secondary')}>
                {triggerContent}
              </div>
            </div>
            {!value && <RiArrowDownSLine className='h-4 w-4 text-text-tertiary' />}
            {!!value && (
              <div className='p-[1px] cursor-pointer group/clear' onClick={(e) => {
                e.stopPropagation()
                onClear()
              }}>
                <RiCloseCircleFill className='h-3.5 w-3.5 text-text-quaternary group-hover/clear:text-text-tertiary' />
              </div>
            )}
          </div>
        </PortalToFollowElemTrigger>
        <PortalToFollowElemContent className='z-[1002]'>
          <div className={cn('relative w-[240px] bg-components-panel-bg-blur rounded-xl border-[0.5px] border-components-panel-border shadow-lg', panelClassName)}>
            <div className='p-1 max-h-72 overflow-auto'>
              {items.map(item => (
                <div
                  key={item.value}
                  className='flex items-center gap-2 pl-3 py-[6px] px-2 rounded-lg cursor-pointer hover:bg-state-base-hover'
                  onClick={() => {
                    onSelect(item)
                    setOpen(false)
                  }}
                >
                  <div title={item.name} className='grow text-text-secondary system-sm-medium truncate'>{item.name}</div>
                  {value === item.value && <RiCheckLine className='shrink-0 w-4 h-4 text-util-colors-blue-light-blue-light-600' />}
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
