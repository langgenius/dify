'use client'
import type { FC } from 'react'
import React from 'react'
import { useTranslation } from 'react-i18next'
import Switch from '../../base/switch'
export enum PlanRange {
  monthly = 'monthly',
  yearly = 'yearly',
}

type Props = {
  value: PlanRange
  onChange: (value: PlanRange) => void
}

const ArrowIcon = (
  <svg xmlns="http://www.w3.org/2000/svg" width="22" height="29" viewBox="0 0 22 29" fill="none">
    <g clipPath="url(#clip0_394_43518)">
      <path d="M2.11312 1.64777C2.11312 1.64777 2.10178 1.64849 2.09045 1.6492C2.06211 1.65099 2.08478 1.64956 2.11312 1.64777ZM9.047 20.493C9.43106 19.9965 8.97268 19.2232 8.35639 19.2848C7.72208 19.4215 6.27243 20.3435 5.13995 20.8814C4.2724 21.3798 3.245 21.6892 2.54015 22.4221C1.87751 23.2831 2.70599 23.9706 3.47833 24.3088C4.73679 24.9578 6.00624 25.6004 7.25975 26.2611C8.4424 26.8807 9.57833 27.5715 10.7355 28.2383C10.9236 28.3345 11.1464 28.3489 11.3469 28.2794C11.9886 28.0796 12.0586 27.1137 11.4432 26.8282C9.83391 25.8485 8.17365 24.9631 6.50314 24.0955C8.93023 24.2384 11.3968 24.1058 13.5161 22.7945C16.6626 20.8097 19.0246 17.5714 20.2615 14.0854C22.0267 8.96164 18.9313 4.08153 13.9897 2.40722C10.5285 1.20289 6.76599 0.996166 3.14837 1.46306C2.50624 1.56611 2.68616 1.53201 2.10178 1.64849C2.12445 1.64706 2.14712 1.64563 2.16979 1.6442C2.01182 1.66553 1.86203 1.72618 1.75582 1.84666C1.48961 2.13654 1.58903 2.63096 1.9412 2.80222C2.19381 2.92854 2.4835 2.83063 2.74986 2.81385C3.7267 2.69541 4.70711 2.63364 5.69109 2.62853C8.30015 2.58932 10.5052 2.82021 13.2684 3.693C21.4149 6.65607 20.7135 14.2162 14.6733 20.0304C12.4961 22.2272 9.31209 22.8944 6.11128 22.4816C5.92391 22.4877 5.72342 22.4662 5.52257 22.439C6.35474 22.011 7.20002 21.6107 8.01305 21.1498C8.35227 20.935 8.81233 20.8321 9.05266 20.4926L9.047 20.493Z" fill="url(#paint0_linear_394_43518)" />
    </g>
    <defs>
      <linearGradient id="paint0_linear_394_43518" x1="11" y1="-48.5001" x2="12.2401" y2="28.2518" gradientUnits="userSpaceOnUse">
        <stop stopColor="#FDB022" />
        <stop offset="1" stopColor="#F79009" />
      </linearGradient>
      <clipPath id="clip0_394_43518">
        <rect width="19.1928" height="27.3696" fill="white" transform="translate(21.8271 27.6475) rotate(176.395)" />
      </clipPath>
    </defs>
  </svg>
)

const SelectPlanRange: FC<Props> = ({
  value,
  onChange,
}) => {
  const { t } = useTranslation()

  return (
    <div className='relative flex flex-col items-end pr-6'>
      <div className='text-sm italic bg-clip-text bg-premium-yearly-tip-text-background text-transparent'>{t('billing.plansCommon.yearlyTip')}</div>
      <div className='flex items-center py-1'>
        <span className='mr-2 text-[13px]'>{t('billing.plansCommon.annualBilling')}</span>
        <Switch size='l' defaultValue={value === PlanRange.yearly} onChange={(v) => {
          onChange(v ? PlanRange.yearly : PlanRange.monthly)
        }} />
      </div>
      <div className='absolute right-0 top-2'>
        {ArrowIcon}
      </div>
    </div>
  )
}
export default React.memo(SelectPlanRange)
