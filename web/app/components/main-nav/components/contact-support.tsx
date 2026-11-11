import { MenuItem, MenuLinkItem } from '@langgenius/dify-ui/menu'
import { useQuery, useSuspenseQuery } from '@tanstack/react-query'
import { useQueryState } from 'nuqs'
import { useTranslation } from 'react-i18next'
import { zendeskRuntime } from '@/app/components/base/zendesk/runtime'
import {
  pricingQueryParamName,
  pricingQueryParser,
} from '@/app/components/billing/pricing/query-params'
import {
  ExternalLinkIndicator,
  MenuItemContent,
} from '@/app/components/header/account-menu/menu-item-content'
import { generateMailToLink } from '@/app/components/header/utils/util'
import { toast } from '@/app/notifications'
import { SUPPORT_EMAIL_ADDRESS, ZENDESK_WIDGET_KEY } from '@/config'
import { systemFeaturesQueryOptions } from '@/features/system-features/client'
import { consoleQuery } from '@/service/console'
import contactSupportIcon from '../assets/contact-support.svg'

type ContactSupportProps = {
  placement: 'menu' | 'sidebar'
}

const sidebarItemClassName =
  'flex h-8 w-full items-center gap-2 rounded-[10px] bg-components-main-nav-nav-button-bg px-2 py-1.5 text-start system-md-medium text-components-main-nav-nav-button-text outline-hidden transition-colors hover:bg-components-main-nav-nav-button-bg-hover hover:text-components-main-nav-nav-button-text focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-state-accent-solid focus-visible:outline-solid'

export default function ContactSupport({ placement }: ContactSupportProps) {
  const { t } = useTranslation(['billing', 'common'])
  const { data: systemFeatures } = useSuspenseQuery(systemFeaturesQueryOptions())
  const deploymentEdition = systemFeatures.deployment_edition
  const { data: plan } = useQuery(
    consoleQuery.features.get.queryOptions({
      enabled: deploymentEdition === 'CLOUD',
      select: (data) => data.billing.subscription.plan,
    }),
  )
  const [, setPricing] = useQueryState(pricingQueryParamName, pricingQueryParser)
  const isPaidCloudPlan =
    deploymentEdition === 'CLOUD' && (plan === 'professional' || plan === 'team')
  const hasZendeskWidget = deploymentEdition === 'CLOUD' && Boolean(ZENDESK_WIDGET_KEY.trim())
  const label = t(($) => $['userProfile.contactSupport'], { ns: 'common' })
  const openZendesk = () => {
    void zendeskRuntime.open(deploymentEdition).catch(() => {
      toast.error(t(($) => $['api.actionFailed'], { ns: 'common' }))
    })
  }

  if (placement === 'sidebar') {
    if (!isPaidCloudPlan || !hasZendeskWidget || systemFeatures.branding.enabled) return null

    return (
      <div className="flex flex-col gap-px p-2">
        <div className="px-1 py-1.5" aria-hidden="true">
          <div className="h-px bg-divider-subtle" />
        </div>
        <button type="button" className={sidebarItemClassName} onClick={openZendesk}>
          <span aria-hidden className="flex size-5 shrink-0 items-center justify-center">
            <img src={contactSupportIcon.src} alt="" width={18} height={18} />
          </span>
          <span className="min-w-0 truncate" title={label}>
            {label}
          </span>
        </button>
      </div>
    )
  }

  if (deploymentEdition === 'CLOUD' && plan === 'sandbox') {
    return (
      <MenuItem className="h-8 gap-1 px-3 py-1" onClick={() => setPricing('open')}>
        <MenuItemContent
          iconClassName="i-ri-chat-smile-2-line text-text-disabled"
          label={<span className="text-text-disabled">{label}</span>}
          trailing={
            <span className="max-w-30 shrink-0 truncate px-1 system-xs-semibold-uppercase text-saas-dify-blue-accessible">
              {t(($) => $['upgradeBtn.encourageShort'], { ns: 'billing' })}
            </span>
          }
        />
      </MenuItem>
    )
  }

  if (deploymentEdition === 'CLOUD' || !SUPPORT_EMAIL_ADDRESS.trim()) return null

  return (
    <MenuLinkItem
      className="h-8 gap-1 px-3 py-1"
      href={generateMailToLink(SUPPORT_EMAIL_ADDRESS)}
      rel="noopener noreferrer"
      target="_blank"
    >
      <MenuItemContent
        iconClassName="i-ri-mail-send-line"
        label={t(($) => $['userProfile.emailSupport'], { ns: 'common' })}
        trailing={<ExternalLinkIndicator />}
      />
    </MenuLinkItem>
  )
}
