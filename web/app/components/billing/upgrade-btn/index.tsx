'use client'
import type { CSSProperties, FC } from 'react'
import React from 'react'
import { useTranslation } from 'react-i18next'
import PremiumBadge from '../../base/premium-badge'
import Button from '@/app/components/base/button'
import { SparklesSoft } from '@/app/components/base/icons/src/public/common'
import { useModalContext } from '@/context/modal-context'

type Props = {
  className?: string
  style?: CSSProperties
  isFull?: boolean
  size?: 's' | 'm' | 'custom'
  isPlain?: boolean
  isShort?: boolean
  onClick?: () => void
  loc?: string
  labelKey?: string
}

const UpgradeBtn: FC<Props> = ({
  className,
  size = 'm',
  style,
  isPlain = false,
  isShort = false,
  onClick: _onClick,
  loc,
  labelKey,
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

  const defaultBadgeLabel = t(`billing.upgradeBtn.${isShort ? 'encourageShort' : 'encourage'}`)
  const label = labelKey ? t(labelKey) : defaultBadgeLabel

  if (isPlain) {
    return (
      <Button
        className={className}
        style={style}
        onClick={onClick}
      >
        {labelKey ? label : t('billing.upgradeBtn.plain')}
      </Button>
    )
  }

  return (
    <PremiumBadge
      size={size}
      color='blue'
      allowHover={true}
      onClick={onClick}
      className={className}
      style={style}
    >
      <SparklesSoft className='flex h-3.5 w-3.5 items-center py-[1px] pl-[3px] text-components-premium-badge-indigo-text-stop-0' />
      <div className='system-xs-medium'>
        <span className='p-1'>
          {label}
        </span>
      </div>
    </PremiumBadge>
  )
}
export default React.memo(UpgradeBtn)
