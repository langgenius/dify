import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@langgenius/dify-ui/dropdown-menu'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import ActionButton, { ActionButtonState } from '@/app/components/base/action-button'

type Props = {
  handleResetChat: () => void
  handleViewChatSettings: () => void
  hideViewChatSettings?: boolean
}

const MobileOperationDropdown = ({
  handleResetChat,
  handleViewChatSettings,
  hideViewChatSettings = false,
}: Props) => {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const handleMenuAction = useCallback((callback: () => void) => {
    setOpen(false)
    queueMicrotask(callback)
  }, [])

  return (
    <DropdownMenu
      open={open}
      onOpenChange={setOpen}
    >
      <DropdownMenuTrigger
        render={(
          <ActionButton
            aria-label={t('operation.more', { ns: 'common' })}
            size="l"
            state={open ? ActionButtonState.Hover : ActionButtonState.Default}
          >
            <div className="i-ri-more-fill h-[18px] w-[18px]" aria-hidden="true" />
          </ActionButton>
        )}
      />
      <DropdownMenuContent
        placement="bottom-end"
        sideOffset={4}
        popupClassName="min-w-[160px]"
      >
        <DropdownMenuItem
          className="system-md-regular"
          onClick={() => handleMenuAction(handleResetChat)}
        >
          <span className="grow">{t('chat.resetChat', { ns: 'share' })}</span>
        </DropdownMenuItem>
        {!hideViewChatSettings && (
          <DropdownMenuItem
            className="system-md-regular"
            onClick={() => handleMenuAction(handleViewChatSettings)}
          >
            <span className="grow">{t('chat.viewChatSettings', { ns: 'share' })}</span>
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>

  )
}

export default MobileOperationDropdown
