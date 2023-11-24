'use client'
import type { FC } from 'react'
import React from 'react'
import cn from 'classnames'
import UpgradeBtn from '../upgrade-btn'
import { Plan } from '../type'
import { useProviderContext } from '@/context/provider-context'

type Props = {
  onClick: () => void
}

const HeaderBillingBtn: FC<Props> = ({
  onClick,
}) => {
  const { plan } = useProviderContext()
  const {
    type,
  } = plan
  if (type === Plan.sandbox)
    return <UpgradeBtn isShort />
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
  return (
    <div onClick={onClick} className={cn(classNames, 'flex items-center h-[22px] px-2 rounded-md border text-xs font-semibold uppercase cursor-pointer')}>
      {name}
    </div>
  )
}
export default React.memo(HeaderBillingBtn)
