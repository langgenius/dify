import { useTranslation } from 'react-i18next'
import { DropdownMenuGroup, DropdownMenuItem, DropdownMenuLinkItem, DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger } from '@/app/components/base/ui/dropdown-menu'
import { toggleZendeskWindow } from '@/app/components/base/zendesk/utils'
import { Plan } from '@/app/components/billing/type'
import { SUPPORT_EMAIL_ADDRESS, ZENDESK_WIDGET_KEY } from '@/config'
import { useAppContext } from '@/context/app-context'
import { useProviderContext } from '@/context/provider-context'
import { mailToSupport } from '../utils/util'
import { ExternalLinkIndicator, MenuItemContent } from './menu-item-content'

type SupportProps = {
  closeAccountDropdown: () => void
}

// Submenu-only: this component must be rendered within an existing DropdownMenu root.
export default function Support({ closeAccountDropdown }: SupportProps) {
  const { t } = useTranslation()
  const { plan } = useProviderContext()
  const { userProfile, langGeniusVersionInfo } = useAppContext()
  const hasDedicatedChannel = plan.type !== Plan.sandbox || Boolean(SUPPORT_EMAIL_ADDRESS.trim())
  const hasZendeskWidget = Boolean(ZENDESK_WIDGET_KEY.trim())

  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger>
        <MenuItemContent
          iconClassName="i-ri-question-line"
          label={t('userProfile.support', { ns: 'common' })}
        />
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent
        popupClassName="w-[216px] divide-y divide-divider-subtle !bg-components-panel-bg-blur !py-0 backdrop-blur-sm"
      >
        <DropdownMenuGroup className="py-1">
          {hasDedicatedChannel && hasZendeskWidget && (
            <DropdownMenuItem
              className="justify-between"
              onClick={() => {
                toggleZendeskWindow(true)
                closeAccountDropdown()
              }}
            >
              <MenuItemContent
                iconClassName="i-ri-chat-smile-2-line"
                label={t('userProfile.contactUs', { ns: 'common' })}
              />
            </DropdownMenuItem>
          )}
          {hasDedicatedChannel && !hasZendeskWidget && (
            <DropdownMenuLinkItem
              className="justify-between"
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
            className="justify-between"
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
            className="justify-between"
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
        </DropdownMenuGroup>
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  )
}
