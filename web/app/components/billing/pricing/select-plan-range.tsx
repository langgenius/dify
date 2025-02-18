'use client'
import type { FC } from 'react'
import React from 'react'
import { useTranslation } from 'react-i18next'
import cn from '@/utils/classnames'
export enum PlanRange {
  monthly = 'monthly',
  yearly = 'yearly',
}

type Props = {
  value: PlanRange
  onChange: (value: PlanRange) => void
}

const ITem: FC<{ isActive: boolean; value: PlanRange; text: string; onClick: (value: PlanRange) => void }> = ({ isActive, value, text, onClick }) => {
  return (
    <div
      className={cn(isActive ? 'bg-[#155EEF] text-white' : 'text-gray-900', 'flex h-11 cursor-pointer items-center rounded-[32px] px-8 text-[15px] font-medium')}
      onClick={() => onClick(value)}
    >
      {text}
    </div>
  )
}

const ArrowIcon = (
  <svg xmlns="http://www.w3.org/2000/svg" width="26" height="38" viewBox="0 0 26 38" fill="none">
    <path d="M20.5005 3.49991C23.5 18 18.7571 25.2595 2.92348 31.9599" stroke="#F26725" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M2.21996 32.2756L8.37216 33.5812" stroke="#F26725" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M2.22168 32.2764L3.90351 27.4459" stroke="#F26725" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)

const SelectPlanRange: FC<Props> = ({
  value,
  onChange,
}) => {
  const { t } = useTranslation()

  return (
    <div>
      <div className='mb-4 text-sm font-medium leading-[18px] text-[#F26725]'>{t('billing.plansCommon.yearlyTip')}</div>

      <div className='relative inline-flex rounded-full border border-black/5 bg-[#F5F8FF] p-1'>
        <ITem isActive={value === PlanRange.monthly} value={PlanRange.monthly} text={t('billing.plansCommon.planRange.monthly') as string} onClick={onChange} />
        <ITem isActive={value === PlanRange.yearly} value={PlanRange.yearly} text={t('billing.plansCommon.planRange.yearly') as string} onClick={onChange} />
        <div className='absolute right-0 top-[-16px] '>
          {ArrowIcon}
        </div>
      </div>
    </div>
  )
}
export default React.memo(SelectPlanRange)
