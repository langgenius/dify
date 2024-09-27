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

type Props = {
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
              'flex items-center px-2 py-1.5 rounded-l-lg bg-components-input-bg-normal cursor-pointer hover:bg-state-base-hover-alt',
              open && '!bg-state-base-hover-alt hover:bg-state-base-hover-alt',
            )}>
              <div className='p-1 flex items-center gap-0.5'>
                <div className='text-text-tertiary system-sm-regular'>{t('appLog.filter.sortBy')}</div>
                <div className={cn('system-sm-regular text-text-tertiary', !!value && 'text-text-secondary')}>
                  {triggerContent}
                </div>
              </div>
              <RiArrowDownSLine className='h-4 w-4 text-text-tertiary' />
            </div>
          </PortalToFollowElemTrigger>
          <PortalToFollowElemContent className='z-[1002]'>
            <div className='relative w-[240px] bg-components-panel-bg-blur rounded-xl border-[0.5px] border-components-panel-border shadow-lg'>
              <div className='p-1 max-h-72 overflow-auto'>
                {items.map(item => (
                  <div
                    key={item.value}
                    className='flex items-center gap-2 pl-3 py-[6px] px-2 rounded-lg cursor-pointer hover:bg-state-base-hover'
                    onClick={() => {
                      onSelect(`${order}${item.value}`)
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
      <div className='ml-px p-2.5 rounded-r-lg bg-components-button-tertiary-bg hover:bg-components-button-tertiary-bg-hover cursor-pointer' onClick={() => onSelect(`${order ? '' : '-'}${value}`)}>
        {!order && <RiSortAsc className='w-4 h-4 text-components-button-tertiary-text' />}
        {order && <RiSortDesc className='w-4 h-4 text-components-button-tertiary-text' />}
      </div>
    </div>

  )
}

export default Sort
