import { MenuLinkItem } from '@langgenius/dify-ui/menu'
import { useTranslation } from 'react-i18next'
import {
  ExternalLinkIndicator,
  MenuItemContent,
} from '@/app/components/header/account-menu/menu-item-content'
import ContactSupport from './contact-support'

export default function SupportMenu() {
  const { t } = useTranslation(['common'])

  return (
    <>
      <ContactSupport placement="menu" />
      <MenuLinkItem
        className="h-8 gap-1 px-3 py-1"
        href="https://discord.gg/5AEfbxcd9k"
        rel="noopener noreferrer"
        target="_blank"
      >
        <MenuItemContent
          iconClassName="i-ri-discord-line"
          label={t(($) => $['userProfile.discord'], { ns: 'common' })}
          trailing={<ExternalLinkIndicator />}
        />
      </MenuLinkItem>
    </>
  )
}
