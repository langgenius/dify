import { DropdownMenuItem, DropdownMenuLinkItem } from '@langgenius/dify-ui/dropdown-menu'
import { useTranslation } from 'react-i18next'
import { openZendeskWindow } from '@/app/components/base/zendesk/utils'
import { Plan } from '@/app/components/billing/type'
import { ExternalLinkIndicator, MenuItemContent } from '@/app/components/header/account-dropdown/menu-item-content'
import { mailToSupport } from '@/app/components/header/utils/util'
import { IS_CLOUD_EDITION, SUPPORT_EMAIL_ADDRESS, ZENDESK_WIDGET_KEY } from '@/config'
import { useAppContext } from '@/context/app-context'
import { useModalContext } from '@/context/modal-context'
import { useProviderContext } from '@/context/provider-context'

type SupportMenuProps = {
  onContactUsClick?: () => void
}

export default function SupportMenu({ onContactUsClick }: SupportMenuProps) {
  const { t } = useTranslation()
  const { enableBilling, plan } = useProviderContext()
  const { userProfile, langGeniusVersionInfo } = useAppContext()
  const { setShowPricingModal } = useModalContext()
  const hasDedicatedChannel = plan.type !== Plan.sandbox || Boolean(SUPPORT_EMAIL_ADDRESS.trim())
  const shouldShowUpgradeContact = IS_CLOUD_EDITION && enableBilling && plan.type === Plan.sandbox && !hasDedicatedChannel
  const hasZendeskWidget = Boolean(ZENDESK_WIDGET_KEY.trim())

  return (
    <>
      {shouldShowUpgradeContact && (
        <DropdownMenuItem
          className="mx-0 h-8 cursor-default gap-1 px-3 py-1"
          onClick={(event) => {
            event.preventDefault()
          }}
        >
          <MenuItemContent
            iconClassName="i-ri-chat-smile-2-line text-text-disabled"
            label={(
              <span className="text-text-disabled">
                {t('userProfile.contactUs', { ns: 'common' })}
              </span>
            )}
            trailing={(
              <button
                type="button"
                className="max-w-30 shrink-0 truncate px-1 system-xs-semibold-uppercase text-saas-dify-blue-accessible transition-colors hover:text-saas-dify-blue-static-hover focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden focus-visible:ring-inset"
                onClick={(event) => {
                  event.stopPropagation()
                  setShowPricingModal()
                  onContactUsClick?.()
                }}
              >
                {t('upgradeBtn.encourageShort', { ns: 'billing' })}
              </button>
            )}
          />
        </DropdownMenuItem>
      )}
      {!shouldShowUpgradeContact && hasDedicatedChannel && hasZendeskWidget && (
        <DropdownMenuItem
          className="mx-0 h-8 gap-1 px-3 py-1"
          onClick={() => {
            openZendeskWindow()
            onContactUsClick?.()
          }}
        >
          <MenuItemContent
            iconClassName="i-ri-chat-smile-2-line"
            label={t('userProfile.contactUs', { ns: 'common' })}
          />
        </DropdownMenuItem>
      )}
      {!shouldShowUpgradeContact && hasDedicatedChannel && !hasZendeskWidget && (
        <DropdownMenuLinkItem
          className="mx-0 h-8 gap-1 px-3 py-1"
          href={mailToSupport(userProfile.email, plan.type, langGeniusVersionInfo?.current_version, SUPPORT_EMAIL_ADDRESS)}
          rel="noopener noreferrer"
          target="_blank"
        >
          <MenuItemContent
            iconClassName="i-ri-mail-send-line"
            label={t('userProfile.emailSupport', { ns: 'common' })}
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
          label={t('userProfile.forum', { ns: 'common' })}
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
          label={t('userProfile.community', { ns: 'common' })}
          trailing={<ExternalLinkIndicator />}
        />
      </DropdownMenuLinkItem>
    </>
  )
}
