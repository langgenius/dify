import {
  DropdownMenuItem,
  DropdownMenuLinkItem,
} from '@langgenius/dify-ui/dropdown-menu'
import { useTranslation } from 'react-i18next'
import { toggleZendeskWindow } from '@/app/components/base/zendesk/utils'
import { ExternalLinkIndicator, MenuItemContent } from '@/app/components/header/account-dropdown/menu-item-content'
import { mailToSupport } from '@/app/components/header/utils/util'
import { SUPPORT_EMAIL_ADDRESS, ZENDESK_WIDGET_KEY } from '@/config'
import { useAppContext } from '@/context/app-context'
import { useProviderContext } from '@/context/provider-context'

export default function SupportMenu() {
  const { t } = useTranslation()
  const { plan } = useProviderContext()
  const { userProfile, langGeniusVersionInfo } = useAppContext()
  const hasZendeskWidget = Boolean(ZENDESK_WIDGET_KEY.trim())

  const renderContactUsItem = () => {
    if (hasZendeskWidget) {
      return (
        <DropdownMenuItem
          className="mx-0 h-8 gap-1 px-3 py-1"
          onClick={() => {
            toggleZendeskWindow(true)
          }}
        >
          <MenuItemContent
            iconClassName="i-ri-chat-smile-2-line"
            label={t('userProfile.contactUs', { ns: 'common' })}
          />
        </DropdownMenuItem>
      )
    }

    return (
      <DropdownMenuLinkItem
        className="mx-0 h-8 gap-1 px-3 py-1"
        href={mailToSupport(userProfile.email, plan.type, langGeniusVersionInfo?.current_version, SUPPORT_EMAIL_ADDRESS)}
        rel="noopener noreferrer"
        target="_blank"
      >
        <MenuItemContent
          iconClassName="i-ri-chat-smile-2-line"
          label={t('userProfile.contactUs', { ns: 'common' })}
        />
      </DropdownMenuLinkItem>
    )
  }

  return (
    <>
      {renderContactUsItem()}
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
