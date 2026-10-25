import { IconButton } from '@langgenius/dify-ui/icon-button'
import { Menu, MenuContent, MenuItem, MenuTrigger } from '@langgenius/dify-ui/menu'
import { useTranslation } from 'react-i18next'

type Props = Readonly<{
  handleResetChat: () => void
  handleViewChatSettings: () => void
  hideViewChatSettings?: boolean
}>

const MobileOperationMenu = ({
  handleResetChat,
  handleViewChatSettings,
  hideViewChatSettings = false,
}: Props) => {
  const { t } = useTranslation(['common', 'share'])
  const handleMenuAction = (callback: () => void) => {
    queueMicrotask(callback)
  }

  return (
    <Menu>
      <MenuTrigger
        render={
          <IconButton
            aria-label={t(($) => $['operation.more'], { ns: 'common' })}
            size="lg"
            className="data-popup-open:bg-state-base-hover"
          >
            <div className="i-ri-more-fill h-4.5 w-4.5" aria-hidden="true" />
          </IconButton>
        }
      />
      <MenuContent align="end" className="min-w-40">
        <MenuItem className="system-md-regular" onClick={() => handleMenuAction(handleResetChat)}>
          <span className="grow">{t(($) => $['chat.resetChat'], { ns: 'share' })}</span>
        </MenuItem>
        {!hideViewChatSettings && (
          <MenuItem
            className="system-md-regular"
            onClick={() => handleMenuAction(handleViewChatSettings)}
          >
            <span className="grow">{t(($) => $['chat.viewChatSettings'], { ns: 'share' })}</span>
          </MenuItem>
        )}
      </MenuContent>
    </Menu>
  )
}

export default MobileOperationMenu
