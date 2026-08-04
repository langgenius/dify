import { Popover, PopoverContent, PopoverTrigger } from '@langgenius/dify-ui/popover'
import { RiChatSettingsLine } from '@remixicon/react'
import { useTranslation } from 'react-i18next'
import ActionButton, { ActionButtonState } from '@/app/components/base/action-button'
import InputsFormContent from '@/app/components/base/chat/chat-with-history/inputs-form/content'
import { Message3Fill } from '@/app/components/base/icons/src/public/other'

const ViewFormDropdown = () => {
  const { t } = useTranslation()
  return (
    <Popover>
      <PopoverTrigger
        render={(props, state) => (
          <ActionButton
            {...props}
            size="l"
            state={state.open ? ActionButtonState.Hover : ActionButtonState.Default}
          >
            <RiChatSettingsLine className="h-4.5 w-4.5" />
          </ActionButton>
        )}
      />
      <PopoverContent
        placement="bottom-end"
        sideOffset={4}
        alignOffset={4}
        popupClassName="border-none bg-transparent shadow-none"
      >
        <div className="w-100 rounded-2xl border-[0.5px] border-components-panel-border bg-components-panel-bg shadow-lg backdrop-blur-xs">
          <div className="flex items-center gap-3 rounded-t-2xl border-b border-divider-subtle px-6 py-4">
            <Message3Fill className="size-6 shrink-0" />
            <div className="grow system-xl-semibold text-text-secondary">
              {t(($) => $['chat.chatSettingsTitle'], { ns: 'share' })}
            </div>
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
