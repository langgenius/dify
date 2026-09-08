'use client'

import { Popover, PopoverContent, PopoverTrigger } from '@langgenius/dify-ui/popover'
import { useQuery } from '@tanstack/react-query'
import { useAtomValue } from 'jotai'
import { useTranslation } from 'react-i18next'
import PremiumBadge from '@/app/components/base/premium-badge'
import { useModalContext } from '@/context/modal-context'
import { deploymentEditionAtom } from '@/features/system-features/state'
import { consoleQuery } from '@/service/console'
import { AccessControlFreePaywall } from './free-paywall'

type GtagHandler = (command: 'event', action: 'click_upgrade_btn', payload: { loc: string }) => void

export function AccessControlEntry() {
  const { t } = useTranslation()
  const deploymentEdition = useAtomValue(deploymentEditionAtom)
  const { data: plan } = useQuery(
    consoleQuery.features.get.queryOptions({
      enabled: deploymentEdition === 'CLOUD',
      select: (data) => data.billing.subscription.plan,
    }),
  )
  const { setShowPricingModal } = useModalContext()

  if (deploymentEdition !== 'CLOUD' || plan !== 'sandbox') return null

  const label = t(($) => $['studio.accessControl.entryLabel'], { ns: 'deployments' })
  const pro = t(($) => $['studio.accessControl.proBadge'], { ns: 'deployments' })

  const handleTurnOn = () => {
    setShowPricingModal()
    const gtag = (window as Window & { gtag?: GtagHandler }).gtag
    if (gtag) gtag('event', 'click_upgrade_btn', { loc: 'access-control-paywall' })
  }

  return (
    <Popover>
      <PopoverTrigger className="flex h-8 shrink-0 items-center gap-1.5 rounded-md border-[0.5px] border-divider-deep px-2.5 shadow-xs outline-hidden hover:bg-state-base-hover focus-visible:ring-2 focus-visible:ring-state-accent-solid">
        <span aria-hidden className="i-ri-shield-keyhole-line size-4 text-text-secondary" />
        <span className="system-sm-medium text-text-secondary">{label}</span>
        <PremiumBadge size="s" color="blue">
          <span
            aria-hidden
            className="i-custom-public-common-sparkles-soft flex h-3.5 w-3.5 items-center py-px pl-0.75 text-components-premium-badge-indigo-text-stop-0"
          />
          <span className="system-xs-medium">{pro}</span>
        </PremiumBadge>
      </PopoverTrigger>
      <PopoverContent
        placement="bottom-end"
        className="w-100 rounded-2xl border-divider-regular p-0 backdrop-blur-[5px]"
      >
        <AccessControlFreePaywall onTurnOn={handleTurnOn} />
      </PopoverContent>
    </Popover>
  )
}
