'use client'
import type { FC } from 'react'
import React from 'react'
import { useTranslation } from 'react-i18next'
import { GoldCoin } from '../../base/icons/src/vender/solid/FinanceAndECommerce'
import { Sparkles } from '../../base/icons/src/public/billing'
import s from './style.module.css'
import cn from '@/utils/classnames'
import { useModalContext } from '@/context/modal-context'

type Props = {
  className?: string
  isFull?: boolean
  size?: 'md' | 'lg'
  isPlain?: boolean
  isShort?: boolean
  onClick?: () => void
  loc?: string
}

const PlainBtn = ({ className, onClick }: { className?: string; onClick: () => void }) => {
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
  onClick: _onClick,
  loc,
}) => {
  const { t } = useTranslation()
  const { setShowPricingModal } = useModalContext()
  const handleClick = () => {
    if (_onClick)
      _onClick()
    else
      (setShowPricingModal as any)()
  }
  const onClick = () => {
    handleClick()
    if (loc && (window as any).gtag) {
      (window as any).gtag('event', 'click_upgrade_btn', {
        loc,
      })
    }
  }

  if (isPlain)
    return <PlainBtn onClick={onClick} className={className} />

  return (
    <div
      className={cn(
        s.upgradeBtn,
        className,
        isFull ? 'justify-center' : 'px-3',
        size === 'lg' ? 'h-10' : 'h-9',
        'relative flex items-center cursor-pointer border rounded-[20px] border-[#0096EA] text-white',
      )}
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
