'use client'
import type { FC } from 'react'
import type { IInputTypeIconProps } from '@/app/components/app/configuration/config-var/input-type-icon'
import { ChevronDownIcon } from '@heroicons/react/24/outline'
import * as React from 'react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import IconTypeIcon from '@/app/components/app/configuration/config-var/input-type-icon'
import {
  PortalToFollowElem,
  PortalToFollowElemContent,
  PortalToFollowElemTrigger,
} from '@/app/components/base/portal-to-follow-elem'
import { cn } from '@/utils/classnames'

type Option = { name: string, value: string, type: string }
export type Props = {
  triggerClassName?: string
  className?: string
  value: string | undefined
  options: Option[]
  onChange: (value: string) => void
  notSelectedVarTip?: string | null
}

const VarItem: FC<{ item: Option }> = ({ item }) => (
  <div className="flex h-[18px] items-center space-x-1 rounded bg-[#EFF8FF] px-1">
    <IconTypeIcon type={item.type as IInputTypeIconProps['type']} className="text-[#1570EF]" />
    <div className="flex text-xs font-medium text-[#1570EF]">
      <span className="opacity-60">{'{{'}</span>
      <span className="max-w-[150px] truncate">{item.value}</span>
      <span className="opacity-60">{'}}'}</span>
    </div>
  </div>
)
const VarPicker: FC<Props> = ({
  triggerClassName,
  className,
  value,
  options,
  onChange,
  notSelectedVarTip,
}) => {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const currItem = options.find(item => item.value === value)
  const notSetVar = !currItem
  return (
    <PortalToFollowElem
      open={open}
      onOpenChange={setOpen}
      placement="bottom-end"
      offset={{
        mainAxis: 8,
      }}
    >
      <PortalToFollowElemTrigger className={cn(triggerClassName)} onClick={() => setOpen(v => !v)}>
        <div className={cn(
          className,
          notSetVar ? 'border-[#FEDF89] bg-[#FFFCF5] text-[#DC6803]' : ' border-components-button-secondary-border text-text-accent hover:bg-components-button-secondary-bg',
          open ? 'bg-components-button-secondary-bg' : 'bg-transparent',
          `
          flex h-8 cursor-pointer items-center justify-center space-x-1 rounded-lg border  px-2 text-[13px]
          font-medium  shadow-xs
          `,
        )}
        >
          <div>
            {value
              ? (
                  <VarItem item={currItem as Option} />
                )
              : (
                  <div>
                    {notSelectedVarTip || t('feature.dataSet.queryVariable.choosePlaceholder', { ns: 'appDebug' })}
                  </div>
                )}
          </div>
          <ChevronDownIcon className={cn(open && 'rotate-180 text-text-tertiary', 'h-3.5 w-3.5')} />
        </div>
      </PortalToFollowElemTrigger>
      <PortalToFollowElemContent style={{ zIndex: 1000 }}>
        {options.length > 0
          ? (
              <div className="max-h-[50vh] w-[240px] overflow-y-auto rounded-lg  border border-components-panel-border bg-components-panel-bg p-1 shadow-lg">
                {options.map(({ name, value, type }, index) => (
                  <div
                    key={index}
                    className="flex cursor-pointer rounded-lg px-3 py-1 hover:bg-state-base-hover"
                    onClick={() => {
                      onChange(value)
                      setOpen(false)
                    }}
                  >
                    <VarItem item={{ name, value, type }} />
                  </div>
                ))}
              </div>
            )
          : (
              <div className="w-[240px] rounded-lg border border-components-panel-border bg-components-panel-bg p-6 shadow-lg">
                <div className="mb-1 text-sm font-medium text-text-secondary">{t('feature.dataSet.queryVariable.noVar', { ns: 'appDebug' })}</div>
                <div className="text-xs leading-normal text-text-tertiary">{t('feature.dataSet.queryVariable.noVarTip', { ns: 'appDebug' })}</div>
              </div>
            )}

      </PortalToFollowElemContent>
    </PortalToFollowElem>
  )
}
export default React.memo(VarPicker)
