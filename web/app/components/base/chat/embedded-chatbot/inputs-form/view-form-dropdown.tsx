import { cn } from '@langgenius/dify-ui/cn'
import { Popover, PopoverContent, PopoverTrigger } from '@langgenius/dify-ui/popover'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import ActionButton, { ActionButtonState } from '@/app/components/base/action-button'
import InputsFormContent from '@/app/components/base/chat/embedded-chatbot/inputs-form/content'

type Props = Readonly<{
  iconColor?: string
}>

const ViewFormDropdown = ({ iconColor }: Props) => {
  const { t } = useTranslation()
  return (
    <Popover>
      <PopoverTrigger
        render={(props, state) => (
          <ActionButton
            {...props}
            size="l"
            state={state.open ? ActionButtonState.Hover : ActionButtonState.Default}
            data-testid="view-form-dropdown-trigger"
          >
            <div className={cn('i-ri-chat-settings-line h-4.5 w-4.5 shrink-0', iconColor)} />
          </ActionButton>
        )}
      />
      <PopoverContent
        placement="bottom-end"
        sideOffset={4}
        alignOffset={4}
        popupClassName="border-none bg-transparent shadow-none"
      >
        <div
          data-testid="view-form-dropdown-content"
          className="w-100 rounded-2xl border-[0.5px] border-components-panel-border bg-components-panel-bg shadow-lg backdrop-blur-xs"
        >
          <div className="flex items-center gap-3 rounded-t-2xl border-b border-divider-subtle px-6 py-4">
            <div className="i-custom-public-other-message-3-fill size-6 shrink-0" />
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
