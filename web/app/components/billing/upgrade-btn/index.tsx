'use client'
import type { FC } from 'react'
import React from 'react'
import { useTranslation } from 'react-i18next'
import PremiumBadge from '../../base/premium-badge'
import Button from '@/app/components/base/button'
import { SparklesSoft } from '@/app/components/base/icons/src/public/common'
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

const UpgradeBtn: FC<Props> = ({
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

  if (isPlain) {
    return (
      <Button onClick={onClick}>
        {t('billing.upgradeBtn.plain')}
      </Button>
    )
  }

  return (
    <PremiumBadge
      size='m'
      color='blue'
      allowHover={true}
      onClick={onClick}
    >
      <SparklesSoft className='flex h-3.5 w-3.5 items-center py-[1px] pl-[3px] text-components-premium-badge-indigo-text-stop-0' />
      <div className='system-xs-medium'>
        <span className='p-1'>
          {t(`billing.upgradeBtn.${isShort ? 'encourageShort' : 'encourage'}`)}
        </span>
      </div>
    </PremiumBadge>
  )
}
export default React.memo(UpgradeBtn)
