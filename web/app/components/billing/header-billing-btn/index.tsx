'use client'
import type { FC } from 'react'
import * as React from 'react'
import { useProviderContext } from '@/context/provider-context'
import { cn } from '@/utils/classnames'
import { Plan } from '../type'
import UpgradeBtn from '../upgrade-btn'

type Props = {
  onClick?: () => void
  isDisplayOnly?: boolean
}

const HeaderBillingBtn: FC<Props> = ({
  onClick,
  isDisplayOnly = false,
}) => {
  const { plan, enableBilling, isFetchedPlan } = useProviderContext()
  const {
    type,
  } = plan

  const name = (() => {
    if (type === Plan.professional)
      return 'pro'
    return type
  })()
  const classNames = (() => {
    if (type === Plan.professional)
      return `border-[#E0F2FE] ${!isDisplayOnly ? 'hover:border-[#B9E6FE]' : ''} bg-[#E0F2FE] text-[#026AA2]`
    if (type === Plan.team)
      return `border-[#E0EAFF] ${!isDisplayOnly ? 'hover:border-[#C7D7FE]' : ''} bg-[#E0EAFF] text-[#3538CD]`
    return ''
  })()

  if (!enableBilling || !isFetchedPlan)
    return null

  if (type === Plan.sandbox)
    return <UpgradeBtn onClick={isDisplayOnly ? undefined : onClick} isShort />

  const handleClick = () => {
    if (!isDisplayOnly && onClick)
      onClick()
  }

  return (
    <div
      onClick={handleClick}
      className={cn(
        classNames,
        'flex h-[22px] items-center rounded-md border px-2 text-xs font-semibold uppercase',
        isDisplayOnly ? 'cursor-default' : 'cursor-pointer',
      )}
    >
      {name}
    </div>
  )
}
export default React.memo(HeaderBillingBtn)
