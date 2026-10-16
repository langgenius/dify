'use client'

import type { CSSProperties, FC } from 'react'
import type { I18nKeysWithPrefix } from '@/types/i18n'
import { Button } from '@langgenius/dify-ui/button'
import { useSuspenseQuery } from '@tanstack/react-query'
import { useQueryState } from 'nuqs'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import {
  pricingQueryParamName,
  pricingQueryParser,
} from '@/app/components/billing/pricing/query-params'
import { systemFeaturesQueryOptions } from '@/features/system-features/client'
import { PremiumBadgeButton } from '../../base/premium-badge'

type Props = Readonly<{
  className?: string
  style?: CSSProperties
  isFull?: boolean
  size?: 's' | 'm' | 'custom'
  isPlain?: boolean
  isShort?: boolean
  onClick?: () => void
  loc?: string
  labelKey?: I18nKeysWithPrefix<'billing', 'upgradeBtn.'> | 'triggerLimitModal.upgrade'
}>

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
  const { t } = useTranslation(['billing'])
  const { data: deploymentEdition } = useSuspenseQuery({
    ...systemFeaturesQueryOptions(),
    select: ({ deployment_edition }) => deployment_edition,
  })
  const [, setPricing] = useQueryState(pricingQueryParamName, pricingQueryParser)

  if (deploymentEdition !== 'CLOUD') return null

  const handleClick = () => {
    if (_onClick) _onClick()
    else setPricing('open')
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

  const defaultBadgeLabel = t(
    ($) => $[isShort ? 'upgradeBtn.encourageShort' : 'upgradeBtn.encourage'],
    { ns: 'billing' },
  )
  const label = labelKey ? t(($) => $[labelKey], { ns: 'billing' }) : defaultBadgeLabel

  if (isPlain) {
    return (
      <Button className={className} style={style} onClick={onClick}>
        {labelKey ? label : t(($) => $['upgradeBtn.plain'], { ns: 'billing' })}
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
      <span
        aria-hidden="true"
        className="i-custom-public-common-sparkles-soft flex h-3.5 w-3.5 items-center [background-clip:content-box] [background-origin:content-box] [mask-clip:content-box] [mask-origin:content-box] py-px pl-0.75 text-components-premium-badge-indigo-text-stop-0"
      />
      <div className="system-xs-medium">
        <span className="p-1">{label}</span>
      </div>
    </PremiumBadgeButton>
  )
}
export default React.memo(UpgradeBtn)
