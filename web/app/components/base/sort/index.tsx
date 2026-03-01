import type { FC } from 'react'
import { RiArrowDownSLine, RiCheckLine, RiSortAsc, RiSortDesc } from '@remixicon/react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  PortalToFollowElem,
  PortalToFollowElemContent,
  PortalToFollowElemTrigger,
} from '@/app/components/base/portal-to-follow-elem'
import { cn } from '@/utils/classnames'

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
    <div className="inline-flex items-center">
      <PortalToFollowElem
        open={open}
        onOpenChange={setOpen}
        placement="bottom-start"
        offset={4}
      >
        <div className="relative">
          <PortalToFollowElemTrigger
            onClick={() => setOpen(v => !v)}
            className="block"
          >
            <div className={cn(
              'flex min-h-8 cursor-pointer items-center rounded-l-lg bg-components-input-bg-normal px-2 py-1 hover:bg-state-base-hover-alt',
              open && '!bg-state-base-hover-alt hover:bg-state-base-hover-alt',
            )}
            >
              <div className="flex items-center gap-0.5 px-1">
                <div className="system-sm-regular text-text-tertiary">{t('filter.sortBy', { ns: 'appLog' })}</div>
                <div className={cn('system-sm-regular text-text-tertiary', !!value && 'text-text-secondary')}>
                  {triggerContent}
                </div>
              </div>
              <RiArrowDownSLine className="h-4 w-4 text-text-tertiary" />
            </div>
          </PortalToFollowElemTrigger>
          <PortalToFollowElemContent className="z-[1002]">
            <div className="relative w-[240px] rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-bg-blur shadow-lg">
              <div className="max-h-72 overflow-auto p-1">
                {items.map(item => (
                  <div
                    key={item.value}
                    className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-[6px] pl-3 hover:bg-state-base-hover"
                    onClick={() => {
                      onSelect(`${order}${item.value}`)
                      setOpen(false)
                    }}
                  >
                    <div title={item.name} className="system-sm-medium grow truncate text-text-secondary">{item.name}</div>
                    {value === item.value && <RiCheckLine className="h-4 w-4 shrink-0 text-util-colors-blue-light-blue-light-600" />}
                  </div>
                ))}
              </div>
            </div>
          </PortalToFollowElemContent>
        </div>
      </PortalToFollowElem>
      <div className="ml-px cursor-pointer rounded-r-lg bg-components-button-tertiary-bg p-2 hover:bg-components-button-tertiary-bg-hover" onClick={() => onSelect(`${order ? '' : '-'}${value}`)}>
        {!order && <RiSortAsc className="h-4 w-4 text-components-button-tertiary-text" />}
        {order && <RiSortDesc className="h-4 w-4 text-components-button-tertiary-text" />}
      </div>
    </div>

  )
}

export default Sort
