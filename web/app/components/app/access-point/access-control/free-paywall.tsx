'use client'

import { Button } from '@langgenius/dify-ui/button'
import { PopoverDescription, PopoverTitle } from '@langgenius/dify-ui/popover'
import { useTranslation } from 'react-i18next'
import { AccessControlRestrictedPreview } from './restricted-preview'

type AccessControlFreePaywallProps = {
  onTurnOn: () => void
}

export function AccessControlFreePaywall({ onTurnOn }: AccessControlFreePaywallProps) {
  const { t } = useTranslation()
  const title = t(($) => $['studio.accessControl.paywallTitle'], { ns: 'deployments' })
  const turnOn = t(($) => $['studio.accessControl.turnOn'], { ns: 'deployments' })
  const pro = t(($) => $['studio.accessControl.proBadge'], { ns: 'deployments' })

  return (
    <div className="flex w-100 flex-col">
      <div className="flex flex-col items-center gap-3 px-8 pt-4 pb-2">
        <div className="flex flex-col items-center gap-1">
          <PopoverTitle className="text-center system-xl-medium text-text-primary">
            {title}
          </PopoverTitle>
          <PopoverDescription className="text-center system-xs-regular text-text-secondary">
            {t(($) => $['studio.accessControl.paywallDescription'], { ns: 'deployments' })}
          </PopoverDescription>
        </div>
        <AccessControlRestrictedPreview />
      </div>
      <div className="px-4 pt-2.5 pb-4">
        <div className="relative">
          <Button variant="primary" className="w-full" onClick={onTurnOn}>
            {turnOn}
          </Button>
          <span
            aria-hidden
            className="pointer-events-none absolute top-1.75 right-1.75 inline-flex h-[18px] items-center overflow-hidden rounded-[5px] border-[0.5px] border-components-premium-badge-blue-stroke-stop-0 px-1 py-[3px] shadow-xs"
            style={{
              backgroundImage:
                'linear-gradient(101.6deg, var(--color-components-premium-badge-blue-stroke-stop-0) 0%, var(--color-components-premium-badge-blue-text-stop-0) 105.58%), linear-gradient(90deg, #a0bdff, #a0bdff)',
            }}
          >
            <span className="i-custom-public-common-sparkles-soft-accent flex h-3.5 w-3.5 items-center py-px pl-0.75" />
            <span className="system-2xs-medium text-text-accent-light-mode-only">{pro}</span>
            <span className="absolute top-0 right-1/2 i-custom-public-common-highlight h-4.5 w-12 translate-x-[20%] opacity-50" />
          </span>
        </div>
      </div>
    </div>
  )
}
