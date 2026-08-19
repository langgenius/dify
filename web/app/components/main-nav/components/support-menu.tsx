import { DropdownMenuItem, DropdownMenuLinkItem } from '@langgenius/dify-ui/dropdown-menu'
import { useSuspenseQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { openZendeskWindow } from '@/app/components/base/zendesk/utils'
import {
  ExternalLinkIndicator,
  MenuItemContent,
} from '@/app/components/header/account-dropdown/menu-item-content'
import { mailToSupport } from '@/app/components/header/utils/util'
import { SUPPORT_EMAIL_ADDRESS, ZENDESK_WIDGET_KEY } from '@/config'
import { useModalContext } from '@/context/modal-context'
import { useProviderContext } from '@/context/provider-context'
import { userProfileQueryOptions } from '@/features/account-profile/client'
import { systemFeaturesQueryOptions } from '@/features/system-features/client'

export default function SupportMenu() {
  const { t } = useTranslation()
  const { data: deploymentEdition } = useSuspenseQuery({
    ...systemFeaturesQueryOptions(),
    select: ({ deployment_edition }) => deployment_edition,
  })
  const { enableBilling, plan } = useProviderContext()
  const { data: accountProfile } = useSuspenseQuery({
    ...userProfileQueryOptions(),
    select: (data) => ({
      email: data.profile.email,
      currentVersion: data.meta.currentVersion,
    }),
  })
  const { setShowPricingModal } = useModalContext()
  const hasDedicatedChannel = plan.type !== 'sandbox' || Boolean(SUPPORT_EMAIL_ADDRESS.trim())
  const shouldShowUpgradeContact =
    deploymentEdition === 'CLOUD' &&
    enableBilling &&
    plan.type === 'sandbox' &&
    !hasDedicatedChannel
  const hasZendeskWidget = deploymentEdition === 'CLOUD' && Boolean(ZENDESK_WIDGET_KEY.trim())

  return (
    <>
      {shouldShowUpgradeContact && (
        <DropdownMenuItem
          aria-label={`${t(($) => $['userProfile.contactUs'], { ns: 'common' })} ${t(($) => $['upgradeBtn.encourageShort'], { ns: 'billing' })}`}
          className="mx-0 h-8 gap-1 px-3 py-1"
          onClick={() => {
            setShowPricingModal()
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
              <span
                aria-hidden
                className="max-w-30 shrink-0 truncate px-1 system-xs-semibold-uppercase text-saas-dify-blue-accessible"
              >
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
            openZendeskWindow(deploymentEdition)
          }}
        >
          <MenuItemContent
            iconClassName="i-ri-chat-smile-2-line"
            label={t(($) => $['userProfile.contactUs'], { ns: 'common' })}
          />
        </DropdownMenuItem>
      )}
      {!shouldShowUpgradeContact && hasDedicatedChannel && !hasZendeskWidget && (
        <DropdownMenuLinkItem
          className="mx-0 h-8 gap-1 px-3 py-1"
          href={mailToSupport(
            accountProfile.email,
            plan.type,
            accountProfile.currentVersion ?? '',
            SUPPORT_EMAIL_ADDRESS,
          )}
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
        href="https://forum.dify.ai/"
        rel="noopener noreferrer"
        target="_blank"
      >
        <MenuItemContent
          iconClassName="i-ri-discuss-line"
          label={t(($) => $['userProfile.forum'], { ns: 'common' })}
          trailing={<ExternalLinkIndicator />}
        />
      </DropdownMenuLinkItem>
      <DropdownMenuLinkItem
        className="mx-0 h-8 gap-1 px-3 py-1"
        href="https://discord.gg/5AEfbxcd9k"
        rel="noopener noreferrer"
        target="_blank"
      >
        <MenuItemContent
          iconClassName="i-ri-discord-line"
          label={t(($) => $['userProfile.community'], { ns: 'common' })}
          trailing={<ExternalLinkIndicator />}
        />
      </DropdownMenuLinkItem>
    </>
  )
}
