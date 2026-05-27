import {
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLinkItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from '@langgenius/dify-ui/dropdown-menu'
import { useTranslation } from 'react-i18next'
import { toggleZendeskWindow } from '@/app/components/base/zendesk/utils'
import { Plan } from '@/app/components/billing/type'
import { ExternalLinkIndicator, MenuItemContent } from '@/app/components/header/account-dropdown/menu-item-content'
import { mailToSupport } from '@/app/components/header/utils/util'
import { SUPPORT_EMAIL_ADDRESS, ZENDESK_WIDGET_KEY } from '@/config'
import { useAppContext } from '@/context/app-context'
import { useProviderContext } from '@/context/provider-context'

export default function SupportMenu() {
  const { t } = useTranslation()
  const { plan } = useProviderContext()
  const { userProfile, langGeniusVersionInfo } = useAppContext()
  const hasDedicatedChannel = plan.type !== Plan.sandbox || Boolean(SUPPORT_EMAIL_ADDRESS.trim())
  const hasZendeskWidget = Boolean(ZENDESK_WIDGET_KEY.trim())

  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger className="mx-0 h-8 gap-1 px-3 py-1">
        <MenuItemContent
          iconClassName="i-ri-question-line"
          label={t('userProfile.support', { ns: 'common' })}
        />
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent
        popupClassName="w-[216px] divide-y divide-divider-subtle bg-components-panel-bg-blur! py-0! backdrop-blur-xs"
      >
        <DropdownMenuGroup className="py-1">
          {hasDedicatedChannel && hasZendeskWidget && (
            <DropdownMenuItem
              className="justify-between"
              onClick={() => {
                toggleZendeskWindow(true)
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
