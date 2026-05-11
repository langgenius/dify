'use client'
import type { CSSProperties, FC } from 'react'
import type { I18nKeysWithPrefix } from '@/types/i18n'
import { Button } from '@langgenius/dify-ui/button'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { SparklesSoft } from '@/app/components/base/icons/src/public/common'
import { useModalContext } from '@/context/modal-context'
import { PremiumBadgeButton } from '../../base/premium-badge'

type Props = {
  className?: string
  style?: CSSProperties
  isFull?: boolean
  size?: 's' | 'm' | 'custom'
  isPlain?: boolean
  isShort?: boolean
  onClick?: () => void
  loc?: string
  labelKey?: Exclude<I18nKeysWithPrefix<'billing'>, 'plans.community.features' | 'plans.enterprise.features' | 'plans.premium.features'>
}

type GtagHandler = (command: 'event', action: 'click_upgrade_btn', payload: { loc: string }) => void

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
      setShowPricingModal()
  }
  const onClick = () => {
    handleClick()
    const gtag = (window as Window & { gtag?: GtagHandler }).gtag
    if (loc && gtag) {
      gtag('event', 'click_upgrade_btn', {
        loc,
      })
    }
  }

  const defaultBadgeLabel = t(isShort ? 'upgradeBtn.encourageShort' : 'upgradeBtn.encourage', { ns: 'billing' })
  const label = labelKey ? t(labelKey, { ns: 'billing' }) : defaultBadgeLabel

  if (isPlain) {
    return (
      <Button
        className={className}
        style={style}
        onClick={onClick}
      >
        {labelKey ? label : t('upgradeBtn.plain', { ns: 'billing' })}
      </Button>
    )
  }

  return (
    <PremiumBadgeButton
      size={size}
      color="blue"
      onClick={onClick}
      className={className}
      style={style}
    >
      <SparklesSoft aria-hidden="true" className="flex h-3.5 w-3.5 items-center py-px pl-[3px] text-components-premium-badge-indigo-text-stop-0" />
      <div className="system-xs-medium">
        <span className="p-1">
          {label}
        </span>
      </div>
    </PremiumBadgeButton>
  )
}
export default React.memo(UpgradeBtn)
