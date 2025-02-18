import type { FC } from 'react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { RiArrowDownSLine, RiCheckLine, RiSortAsc, RiSortDesc } from '@remixicon/react'
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

interface Props {
  order?: string
  value: number | string
  items: Item[]
  onSelect: (item: any) => void
}
const Sort: FC<Props> = ({
  order,
  value,
  items,
  onSelect,
}) => {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)

  const triggerContent = useMemo(() => {
    return items.find(item => item.value === value)?.name || ''
  }, [items, value])

  return (
    <div className='inline-flex items-center'>
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
              'bg-components-input-bg-normal hover:bg-state-base-hover-alt flex cursor-pointer items-center rounded-l-lg px-2 py-1',
              open && '!bg-state-base-hover-alt hover:bg-state-base-hover-alt',
            )}>
              <div className='flex items-center gap-0.5 p-1'>
                <div className='text-text-tertiary system-sm-regular'>{t('appLog.filter.sortBy')}</div>
                <div className={cn('system-sm-regular text-text-tertiary', !!value && 'text-text-secondary')}>
                  {triggerContent}
                </div>
              </div>
              <RiArrowDownSLine className='text-text-tertiary h-4 w-4' />
            </div>
          </PortalToFollowElemTrigger>
          <PortalToFollowElemContent className='z-[1002]'>
            <div className='bg-components-panel-bg-blur border-components-panel-border relative w-[240px] rounded-xl border-[0.5px] shadow-lg'>
              <div className='max-h-72 overflow-auto p-1'>
                {items.map(item => (
                  <div
                    key={item.value}
                    className='hover:bg-state-base-hover flex cursor-pointer items-center gap-2 rounded-lg px-2 py-[6px] pl-3'
                    onClick={() => {
                      onSelect(`${order}${item.value}`)
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
      <div className='bg-components-button-tertiary-bg hover:bg-components-button-tertiary-bg-hover ml-px cursor-pointer rounded-r-lg p-2' onClick={() => onSelect(`${order ? '' : '-'}${value}`)}>
        {!order && <RiSortAsc className='text-components-button-tertiary-text h-4 w-4' />}
        {order && <RiSortDesc className='text-components-button-tertiary-text h-4 w-4' />}
      </div>
    </div>

  )
}

export default Sort
