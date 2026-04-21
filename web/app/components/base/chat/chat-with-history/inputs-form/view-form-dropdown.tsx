import { Popover, PopoverContent, PopoverTrigger } from '@langgenius/dify-ui/popover'
import {
  RiChatSettingsLine,
} from '@remixicon/react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import ActionButton, { ActionButtonState } from '@/app/components/base/action-button'
import InputsFormContent from '@/app/components/base/chat/chat-with-history/inputs-form/content'
import { Message3Fill } from '@/app/components/base/icons/src/public/other'

const ViewFormDropdown = () => {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)

  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
    >
      <PopoverTrigger
        render={(
          <ActionButton size="l" state={open ? ActionButtonState.Hover : ActionButtonState.Default}>
            <RiChatSettingsLine className="h-[18px] w-[18px]" />
          </ActionButton>
        )}
      />
      <PopoverContent
        placement="bottom-end"
        sideOffset={4}
        alignOffset={4}
        popupClassName="border-none bg-transparent shadow-none"
      >
        <div className="w-[400px] rounded-2xl border-[0.5px] border-components-panel-border bg-components-panel-bg shadow-lg backdrop-blur-xs">
          <div className="flex items-center gap-3 rounded-t-2xl border-b border-divider-subtle px-6 py-4">
            <Message3Fill className="h-6 w-6 shrink-0" />
            <div className="grow system-xl-semibold text-text-secondary">{t('chat.chatSettingsTitle', { ns: 'share' })}</div>
          </div>
          <div className="p-6">
            <InputsFormContent />
          </div>
        </div>
      </PopoverContent>
    </Popover>

  )
}

export default ViewFormDropdown
