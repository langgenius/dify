import {
  RiChatSettingsLine,
} from '@remixicon/react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import ActionButton, { ActionButtonState } from '@/app/components/base/action-button'
import InputsFormContent from '@/app/components/base/chat/embedded-chatbot/inputs-form/content'
import { Message3Fill } from '@/app/components/base/icons/src/public/other'
import { PortalToFollowElem, PortalToFollowElemContent, PortalToFollowElemTrigger } from '@/app/components/base/portal-to-follow-elem'
import { cn } from '@/utils/classnames'

type Props = {
  iconColor?: string
}
const ViewFormDropdown = ({ iconColor }: Props) => {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)

  return (
    <PortalToFollowElem
      open={open}
      onOpenChange={setOpen}
      placement="bottom-end"
      offset={{
        mainAxis: 4,
        crossAxis: 4,
      }}
    >
      <PortalToFollowElemTrigger
        onClick={() => setOpen(v => !v)}
      >
        <ActionButton size="l" state={open ? ActionButtonState.Hover : ActionButtonState.Default}>
          <RiChatSettingsLine className={cn('h-[18px] w-[18px]', iconColor)} />
        </ActionButton>
      </PortalToFollowElemTrigger>
      <PortalToFollowElemContent className="z-[99]">
        <div className="w-[400px] rounded-2xl border-[0.5px] border-components-panel-border bg-components-panel-bg shadow-lg backdrop-blur-sm">
          <div className="flex items-center gap-3 rounded-t-2xl border-b border-divider-subtle px-6 py-4">
            <Message3Fill className="h-6 w-6 shrink-0" />
            <div className="system-xl-semibold grow text-text-secondary">{t('chat.chatSettingsTitle', { ns: 'share' })}</div>
          </div>
          <div className="p-6">
            <InputsFormContent />
          </div>
        </div>
      </PortalToFollowElemContent>
    </PortalToFollowElem>

  )
}

export default ViewFormDropdown
