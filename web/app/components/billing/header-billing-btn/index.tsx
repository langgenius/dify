'use client'
import type { FC } from 'react'
import React from 'react'
import UpgradeBtn from '../upgrade-btn'
import { Plan } from '../type'
import cn from '@/utils/classnames'
import { useProviderContext } from '@/context/provider-context'

type Props = {
  onClick: () => void
}

const HeaderBillingBtn: FC<Props> = ({
  onClick,
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
      return 'border-[#E0F2FE] hover:border-[#B9E6FE] bg-[#E0F2FE] text-[#026AA2]'
    if (type === Plan.team)
      return 'border-[#E0EAFF] hover:border-[#C7D7FE] bg-[#E0EAFF] text-[#3538CD]'
    return ''
  })()

  if (!enableBilling || !isFetchedPlan)
    return null

  if (type === Plan.sandbox)
    return <UpgradeBtn onClick={onClick} isShort />

  return (
    <div onClick={onClick} className={cn(classNames, 'flex items-center h-[22px] px-2 rounded-md border text-xs font-semibold uppercase cursor-pointer')}>
      {name}
    </div>
  )
}
export default React.memo(HeaderBillingBtn)
