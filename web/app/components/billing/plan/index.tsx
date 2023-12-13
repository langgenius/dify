'use client'
import type { FC } from 'react'
import React from 'react'
import cn from 'classnames'
import { useTranslation } from 'react-i18next'
import { Plan } from '../type'
import VectorSpaceInfo from '../usage-info/vector-space-info'
import AppsInfo from '../usage-info/apps-info'
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

type Props = {
  loc: string
}

const PlanComp: FC<Props> = ({
  loc,
}) => {
  const { t } = useTranslation()
  const { plan } = useProviderContext()
  const {
    type,
  } = plan

  const isInHeader = loc === 'header'

  return (
    <div
      className='rounded-xl border border-white select-none'
      style={{
        background: typeStyle[type].bg,
        boxShadow: '5px 7px 12px 0px rgba(0, 0, 0, 0.06)',
      }}
    >
      <div className='flex justify-between px-6 py-5 items-center'>
        <div>
          <div
            className='leading-[18px] text-xs font-normal opacity-70'
            style={{
              color: 'rgba(0, 0, 0, 0.64)',
            }}
          >
            {t('billing.currentPlan')}
          </div>
          <div className={cn(typeStyle[type].textClassNames, 'leading-[125%] text-lg font-semibold uppercase')}>
            {t(`billing.plans.${type}.name`)}
          </div>
        </div>
        {(!isInHeader || (isInHeader && type !== Plan.sandbox)) && (
          <UpgradeBtn
            className='flex-shrink-0'
            isPlain={type !== Plan.sandbox}
            loc={loc}
          />
        )}
      </div>

      {/* Plan detail */}
      <div className='rounded-xl bg-white px-6 py-3'>
        <VectorSpaceInfo className='py-3' />
        <AppsInfo className='py-3' />
        {isInHeader && type === Plan.sandbox && (
          <UpgradeBtn
            className='flex-shrink-0 my-3'
            isFull
            size='lg'
            isPlain={type !== Plan.sandbox}
            loc={loc}
          />
        )}
      </div>
    </div>
  )
}
export default React.memo(PlanComp)
