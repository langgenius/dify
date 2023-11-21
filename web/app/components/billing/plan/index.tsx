'use client'
import type { FC } from 'react'
import React from 'react'
import cn from 'classnames'
import { Plan } from '../type'
import UsageInfo from '../usage-info'
import UpgradeBtn from '../upgrade-btn'
import { useProviderContext } from '@/context/provider-context'
const typeStyle = {
  [Plan.sandbox]: {
    textClassNames: 'text-gray-900',
    bg: 'linear-gradient(113deg, rgba(255, 255, 255, 0.51) 3.51%, rgba(255, 255, 255, 0.00) 111.71%), #EAECF0',
  },
  [Plan.professional]: {
    textClassNames: 'text-[#026AA2]',
    bg: 'linear-gradient(113deg, rgba(255, 255, 255, 0.51) 3.51%, rgba(255, 255, 255, 0.00) 111.71%), #E0F2FE',
  },
  [Plan.team]: {
    textClassNames: 'text-[#3538CD]',
    bg: 'linear-gradient(113deg, rgba(255, 255, 255, 0.51) 3.51%, rgba(255, 255, 255, 0.00) 111.71%), #E0EAFF',
  },
  [Plan.enterprise]: {
    textClassNames: 'text-[#DC6803]',
    bg: 'linear-gradient(113deg, rgba(255, 255, 255, 0.51) 3.51%, rgba(255, 255, 255, 0.00) 111.71%), #FFEED3',
  },
}

const PlanComp: FC = () => {
  const { plan } = useProviderContext()
  const {
    type,
    usage,
    total,
  } = plan

  return (
    <div
      className='rounded-xl border border-white'
      style={{
        background: typeStyle[type].bg,
        boxShadow: '5px 7px 12px 0px rgba(0, 0, 0, 0.06)',
      }}
    >
      <div className='flex justify-between px-6 py-5 items-center'>
        <div>
          <div className='leading-[18px] text-xs font-normal text-black opacity-70'>Current Plan</div>
          <div className={cn(typeStyle[type].textClassNames, 'leading-[125%] text-lg font-semibold uppercase')}>{type}</div>
        </div>
        <UpgradeBtn
          className='flex-shrink-0'
          isPlain={type !== Plan.sandbox}
          onClick={() => { }}
        />
      </div>

      {/* Plan detail */}
      <div className='rounded-xl bg-white px-6 py-3'>
        <UsageInfo
          className='py-3'
          icon={<div></div>}
          name={'x'}
          tooltip={'xx'}
          usage={usage.vectorSpace}
          total={total.vectorSpace}
          unit='MB'
        />
        <UsageInfo
          className='py-3'
          icon={<div></div>}
          name={'x'}
          tooltip={'xx'}
          usage={usage.buildApps}
          total={total.buildApps}
        />
      </div>
    </div>
  )
}
export default React.memo(PlanComp)
