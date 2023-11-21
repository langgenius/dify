'use client'
import type { FC } from 'react'
import React from 'react'
import cn from 'classnames'
import { Plan } from '../type'
import UsageInfo from '../usage-info'
import { useProviderContext } from '@/context/provider-context'
const typeStyle = {
  [Plan.sandbox]: {
    textClassNames: 'text-gray-900',
    bg: 'linear-gradient(113deg, rgba(255, 255, 255, 0.51) 3.51%, rgba(255, 255, 255, 0.00) 111.71%), #EAECF0',
  },
  [Plan.professional]: {
    textClassNames: 'text-gray-900',
    bg: 'linear-gradient(113deg, rgba(255, 255, 255, 0.51) 3.51%, rgba(255, 255, 255, 0.00) 111.71%), #EAECF0',
  },
  [Plan.team]: {
    textClassNames: 'text-gray-900',
    bg: 'linear-gradient(113deg, rgba(255, 255, 255, 0.51) 3.51%, rgba(255, 255, 255, 0.00) 111.71%), #EAECF0',
  },
  [Plan.enterprise]: {
    textClassNames: 'text-gray-900',
    bg: 'linear-gradient(113deg, rgba(255, 255, 255, 0.51) 3.51%, rgba(255, 255, 255, 0.00) 111.71%), #EAECF0',
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
      className='rounded-lg'
      style={{
        background: typeStyle[type].bg,
      }}
    >
      <div className='flex justify-between px-6 py-5 items-center'>
        <div>
          <div>Current Plan</div>
          <div className={cn(typeStyle[type].textClassNames, 'leading-[125%] text-lg font-semibold uppercase')}>{type}</div>
        </div>
        <div>Upgrade Plan</div>
      </div>

      {/* Plan detail */}
      <div>
        <UsageInfo
          icon={<div></div>}
          name={'x'}
          tooltip={'xx'}
          usage={usage.vectorSpace}
          total={total.vectorSpace}
          unit='MB'
        />
        <UsageInfo
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
