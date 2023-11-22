'use client'
import type { FC } from 'react'
import React from 'react'
import { useTranslation } from 'react-i18next'
import cn from 'classnames'
import { GoldCoin } from '../../base/icons/src/vender/solid/FinanceAndECommerce'
import { Sparkles } from '../../base/icons/src/public/billing'

type Props = {
  className?: string
  isFull?: boolean
  size?: 'md' | 'lg'
  isPlain?: boolean
  isShort?: boolean
  onClick: () => void
}

const PlainBtn = ({ className, onClick }: Props) => {
  const { t } = useTranslation()

  return (
    <div
      className={cn(className, 'flex items-center h-8 px-3 rounded-lg border border-gray-200 bg-white shadow-sm cursor-pointer')}
      onClick={onClick}
    >
      <div className='leading-[18px] text-[13px] font-medium text-gray-700'>
        {t('billing.upgradeBtn.plain')}
      </div>
    </div>
  )
}

const UpgradeBtn: FC<Props> = ({
  className,
  isPlain = false,
  isFull = false,
  isShort = false,
  size = 'md',
  onClick,
}) => {
  const { t } = useTranslation()

  if (isPlain)
    return <PlainBtn onClick={onClick} className={className} />

  return (
    <div
      className={cn(
        className,
        isFull ? 'justify-center' : 'px-3',
        size === 'lg' ? 'h-10' : 'h-9',
        'relative flex items-center cursor-pointer border rounded-[20px] border-[#0096EA] text-white',
      )}
      style={{
        background: 'linear-gradient(99deg, rgba(255, 255, 255, 0.12) 7.16%, rgba(255, 255, 255, 0.00) 85.47%), linear-gradient(280deg, #00B2FF 12.96%, #132BFF 90.95%)',
        boxShadow: '0px 2px 4px -2px rgba(16, 24, 40, 0.06), 0px 4px 8px -2px rgba(0, 162, 253, 0.12)',
      }}
      onClick={onClick}
    >
      <GoldCoin className='mr-1 w-3.5 h-3.5' />
      <div className='text-xs font-normal'>{t(`billing.upgradeBtn.${isShort ? 'encourageShort' : 'encourage'}`)}</div>
      <Sparkles
        className='absolute -right-1 -top-2  w-4 h-5 bg-cover'
      />
    </div>
  )
}
export default React.memo(UpgradeBtn)
