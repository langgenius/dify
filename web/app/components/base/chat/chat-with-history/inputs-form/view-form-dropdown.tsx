import { IconButton } from '@langgenius/dify-ui/icon-button'
import { Popover, PopoverContent, PopoverTrigger } from '@langgenius/dify-ui/popover'
import { useTranslation } from 'react-i18next'
import InputsFormContent from '@/app/components/base/chat/chat-with-history/inputs-form/content'

const ViewFormDropdown = () => {
  const { t } = useTranslation()
  return (
    <Popover>
      <PopoverTrigger
        render={
          <IconButton
            aria-label={t(($) => $['chat.viewChatSettings'], { ns: 'share' })}
            size="lg"
            className="data-popup-open:bg-state-base-hover"
          >
            <span aria-hidden="true" className="i-ri-chat-settings-line h-4.5 w-4.5" />
          </IconButton>
        }
      />
      <PopoverContent
        placement="bottom-end"
        sideOffset={4}
        alignOffset={4}
        className="border-none bg-transparent shadow-none"
      >
        <div className="w-100 rounded-2xl border-[0.5px] border-components-panel-border bg-components-panel-bg shadow-lg backdrop-blur-xs">
          <div className="flex items-center gap-3 rounded-t-2xl border-b border-divider-subtle px-6 py-4">
            <span aria-hidden className="i-custom-public-other-message-3-fill size-6 shrink-0" />
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
