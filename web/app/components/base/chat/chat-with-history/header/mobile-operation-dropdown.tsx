import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@langgenius/dify-ui/dropdown-menu'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import { useTranslation } from 'react-i18next'

type Props = Readonly<{
  handleResetChat: () => void
  handleViewChatSettings: () => void
  hideViewChatSettings?: boolean
}>

const MobileOperationDropdown = ({
  handleResetChat,
  handleViewChatSettings,
  hideViewChatSettings = false,
}: Props) => {
  const { t } = useTranslation()
  const handleMenuAction = (callback: () => void) => {
    queueMicrotask(callback)
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
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
      <DropdownMenuContent placement="bottom-end" sideOffset={4} className="min-w-[160px]">
        <DropdownMenuItem
          className="system-md-regular"
          onClick={() => handleMenuAction(handleResetChat)}
        >
          <span className="grow">{t(($) => $['chat.resetChat'], { ns: 'share' })}</span>
        </DropdownMenuItem>
        {!hideViewChatSettings && (
          <DropdownMenuItem
            className="system-md-regular"
            onClick={() => handleMenuAction(handleViewChatSettings)}
          >
            <span className="grow">{t(($) => $['chat.viewChatSettings'], { ns: 'share' })}</span>
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export default MobileOperationDropdown
