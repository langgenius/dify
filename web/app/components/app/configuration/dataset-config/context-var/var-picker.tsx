'use client'
import type { FC } from 'react'
import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDownIcon } from '@heroicons/react/24/outline'
import s from './style.module.css'
import cn from '@/utils/classnames'
import {
  PortalToFollowElem,
  PortalToFollowElemContent,
  PortalToFollowElemTrigger,
} from '@/app/components/base/portal-to-follow-elem'
import type { IInputTypeIconProps } from '@/app/components/app/configuration/config-var/input-type-icon'
import IconTypeIcon from '@/app/components/app/configuration/config-var/input-type-icon'

type Option = { name: string; value: string; type: string }
export type Props = {
  triggerClassName?: string
  className?: string
  value: string | undefined
  options: Option[]
  onChange: (value: string) => void
  notSelectedVarTip?: string | null
}

const VarItem: FC<{ item: Option }> = ({ item }) => (
  <div className='flex items-center h-[18px] px-1 bg-[#EFF8FF] rounded space-x-1'>
    <IconTypeIcon type={item.type as IInputTypeIconProps['type']} className='text-[#1570EF]' />
    <div className='flex text-xs font-medium text-[#1570EF]'>
      <span className='opacity-60'>{'{{'}</span>
      <span className='max-w-[150px] truncate'>{item.value}</span>
      <span className='opacity-60'>{'}}'}</span>
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
      placement='bottom-end'
      offset={{
        mainAxis: 8,
      }}
    >
      <PortalToFollowElemTrigger className={cn(triggerClassName)} onClick={() => setOpen(v => !v)}>
        <div className={cn(
          s.trigger,
          className,
          notSetVar ? 'bg-[#FFFCF5] border-[#FEDF89] text-[#DC6803]' : ' hover:bg-gray-50 border-gray-200 text-primary-600',
          open ? 'bg-gray-50' : 'bg-white',
          `
          flex items-center h-8 justify-center px-2 space-x-1 rounded-lg border  shadow-xs cursor-pointer
          text-[13px]  font-medium
          `)}>
          <div>
            {value
              ? (
                <VarItem item={currItem as Option} />
              )
              : (<div>
                {notSelectedVarTip || t('appDebug.feature.dataSet.queryVariable.choosePlaceholder')}
              </div>)}
          </div>
          <ChevronDownIcon className={cn(s.dropdownIcon, open && 'rotate-180 text-[#98A2B3]', 'w-3.5 h-3.5')} />
        </div>
      </PortalToFollowElemTrigger>
      <PortalToFollowElemContent style={{ zIndex: 1000 }}>
        {options.length > 0
          ? (<div className='w-[240px] max-h-[50vh] overflow-y-auto p-1  border bg-white border-gray-200 rounded-lg shadow-lg'>
            {options.map(({ name, value, type }, index) => (
              <div
                key={index}
                className='px-3 py-1 flex rounded-lg hover:bg-gray-50 cursor-pointer'
                onClick={() => {
                  onChange(value)
                  setOpen(false)
                }}
              >
                <VarItem item={{ name, value, type }} />
              </div>
            ))}
          </div>)
          : (
            <div className='w-[240px] p-6 bg-white border border-gray-200 rounded-lg shadow-lg'>
              <div className='mb-1 text-sm font-medium text-gray-700'>{t('appDebug.feature.dataSet.queryVariable.noVar')}</div>
              <div className='text-xs leading-normal text-gray-500'>{t('appDebug.feature.dataSet.queryVariable.noVarTip')}</div>
            </div>
          )}

      </PortalToFollowElemContent>
    </PortalToFollowElem>
  )
}
export default React.memo(VarPicker)
