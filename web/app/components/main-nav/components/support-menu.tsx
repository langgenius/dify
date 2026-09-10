import { DropdownMenuItem, DropdownMenuLinkItem } from '@langgenius/dify-ui/dropdown-menu'
import { toast } from '@langgenius/dify-ui/toast'
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
} from '@/app/components/header/account-dropdown/menu-item-content'
import { generateMailToLink, mailToSupport } from '@/app/components/header/utils/util'
import { SUPPORT_EMAIL_ADDRESS, ZENDESK_WIDGET_KEY } from '@/config'
import { userProfileQueryOptions } from '@/features/account-profile/client'
import { systemFeaturesQueryOptions } from '@/features/system-features/client'
import { consoleQuery } from '@/service/console'

export default function SupportMenu() {
  const { t } = useTranslation()
  const { data: deploymentEdition } = useSuspenseQuery({
    ...systemFeaturesQueryOptions(),
    select: ({ deployment_edition }) => deployment_edition,
  })
  const { data: plan } = useQuery(
    consoleQuery.features.get.queryOptions({
      enabled: deploymentEdition === 'CLOUD',
      select: (data) => data.billing.subscription.plan,
    }),
  )
  const { data: accountProfile } = useSuspenseQuery({
    ...userProfileQueryOptions(),
    select: (data) => ({
      email: data.profile.email,
      currentVersion: data.meta.currentVersion,
    }),
  })
  const [, setPricing] = useQueryState(pricingQueryParamName, pricingQueryParser)
  const hasDedicatedChannel =
    (deploymentEdition === 'CLOUD' && (plan === 'professional' || plan === 'team')) ||
    Boolean(SUPPORT_EMAIL_ADDRESS.trim())
  const shouldShowUpgradeContact =
    deploymentEdition === 'CLOUD' && plan === 'sandbox' && !hasDedicatedChannel
  const supportMailLink =
    deploymentEdition !== 'CLOUD'
      ? generateMailToLink(SUPPORT_EMAIL_ADDRESS)
      : plan === undefined
        ? undefined
        : mailToSupport(
            accountProfile.email,
            plan,
            accountProfile.currentVersion ?? '',
            SUPPORT_EMAIL_ADDRESS,
          )
  const hasZendeskWidget = deploymentEdition === 'CLOUD' && Boolean(ZENDESK_WIDGET_KEY.trim())

  return (
    <>
      {shouldShowUpgradeContact && (
        <DropdownMenuItem
          className="mx-0 h-8 gap-1 px-3 py-1"
          onClick={() => {
            setPricing('open')
          }}
        >
          <MenuItemContent
            iconClassName="i-ri-chat-smile-2-line text-text-disabled"
            label={
              <span className="text-text-disabled">
                {t(($) => $['userProfile.contactUs'], { ns: 'common' })}
              </span>
            }
            trailing={
              <span className="max-w-30 shrink-0 truncate px-1 system-xs-semibold-uppercase text-saas-dify-blue-accessible">
                {t(($) => $['upgradeBtn.encourageShort'], { ns: 'billing' })}
              </span>
            }
          />
        </DropdownMenuItem>
      )}
      {!shouldShowUpgradeContact && hasDedicatedChannel && hasZendeskWidget && (
        <DropdownMenuItem
          className="mx-0 h-8 gap-1 px-3 py-1"
          onClick={() => {
            void zendeskRuntime.open(deploymentEdition).catch(() => {
              toast.error(t(($) => $['api.actionFailed'], { ns: 'common' }))
            })
          }}
        >
          <MenuItemContent
            iconClassName="i-ri-chat-smile-2-line"
            label={t(($) => $['userProfile.contactUs'], { ns: 'common' })}
          />
        </DropdownMenuItem>
      )}
      {!shouldShowUpgradeContact && hasDedicatedChannel && !hasZendeskWidget && supportMailLink && (
        <DropdownMenuLinkItem
          className="mx-0 h-8 gap-1 px-3 py-1"
          href={supportMailLink}
          rel="noopener noreferrer"
          target="_blank"
        >
          <MenuItemContent
            iconClassName="i-ri-mail-send-line"
            label={t(($) => $['userProfile.emailSupport'], { ns: 'common' })}
            trailing={<ExternalLinkIndicator />}
          />
        </DropdownMenuLinkItem>
      )}
      <DropdownMenuLinkItem
        className="mx-0 h-8 gap-1 px-3 py-1"
        href="https://discord.gg/5AEfbxcd9k"
        rel="noopener noreferrer"
        target="_blank"
      >
        <MenuItemContent
          iconClassName="i-ri-discord-line"
          label={t(($) => $['userProfile.discord'], { ns: 'common' })}
          trailing={<ExternalLinkIndicator />}
        />
      </DropdownMenuLinkItem>
    </>
  )
}
