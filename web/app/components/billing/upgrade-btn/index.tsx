'use client'
import type { FC } from 'react'
import React from 'react'
import { useTranslation } from 'react-i18next'
import PremiumBadge from '../../base/premium-badge'
import { SparklesSoft } from '@/app/components/base/icons/src/public/common'
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
  isShort = false,
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
    <PremiumBadge
      size="m"
      color="blue"
      allowHover={true}
      onClick={onClick}
    >
      <SparklesSoft className='flex items-center py-[1px] pl-[3px] w-3.5 h-3.5 text-components-premium-badge-indigo-text-stop-0' />
      <div className='system-xs-medium'>
        <span className='p-1'>
          {t(`billing.upgradeBtn.${isShort ? 'encourageShort' : 'encourage'}`)}
        </span>
      </div>
    </PremiumBadge>
  )
}
export default React.memo(UpgradeBtn)
