import type { FC } from 'react'
import React from 'react'
import { useTranslation } from 'react-i18next'

const StarIcon = (
  <svg width="50" height="50" viewBox="0 0 50 50" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M7.50033 48.3337V36.667M7.50033 13.3337V1.66699M1.66699 7.50033H13.3337M1.66699 42.5003H13.3337M27.3337 4.00032L23.2872 14.521C22.6292 16.2319 22.3002 17.0873 21.7886 17.8069C21.3351 18.4446 20.7779 19.0018 20.1402 19.4552C19.4206 19.9669 18.5652 20.2959 16.8543 20.9539L6.33366 25.0003L16.8543 29.0467C18.5652 29.7048 19.4206 30.0338 20.1402 30.5454C20.7779 30.9989 21.3351 31.5561 21.7886 32.1938C22.3002 32.9133 22.6292 33.7688 23.2872 35.4796L27.3337 46.0003L31.3801 35.4796C32.0381 33.7688 32.3671 32.9133 32.8788 32.1938C33.3322 31.5561 33.8894 30.9989 34.5271 30.5454C35.2467 30.0338 36.1021 29.7048 37.813 29.0467L48.3337 25.0003L37.813 20.9539C36.1021 20.2959 35.2467 19.9669 34.5271 19.4552C33.8894 19.0018 33.3322 18.4446 32.8788 17.8069C32.3671 17.0873 32.0381 16.2319 31.3801 14.521L27.3337 4.00032Z" stroke="#EAECF0" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
  </svg>

)

export type INoDataProps = {}
const NoData: FC<INoDataProps> = () => {
  const { t } = useTranslation()
  return (
    <div className='flex h-full w-full flex-col items-center justify-center'>
      {StarIcon}
      <div
        className='mt-3 text-xs leading-3 text-gray-300'
      >
        {t('share.generation.noData')}
      </div>
    </div>
  )
}
export default React.memo(NoData)
