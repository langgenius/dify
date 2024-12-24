import Indicator from '@/app/components/header/indicator'
import type { ComponentProps, PropsWithChildren } from 'react'

export type SettingItemProps = PropsWithChildren<{
  label: string
  indicator?: ComponentProps<typeof Indicator>['color']
}>

export const SettingItem = ({ label, children, indicator }: SettingItemProps) => {
  return <div className='flex items-center h-6 justify-between bg-gray-100 rounded-md  px-1 space-x-1 text-xs font-normal relative'>
    <div className='max-w-[100px] shrink-0 truncate text-xs font-medium text-text-tertiary uppercase'>
      {label}
    </div>
    <div className='grow w-0 shrink-0 truncate text-right text-xs font-normal text-text-secondary'>
      {children}
    </div>
    {indicator && <Indicator color={indicator} className='absolute -right-0.5 -top-0.5' />}
  </div>
}
