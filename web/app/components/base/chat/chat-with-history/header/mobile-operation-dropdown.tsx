import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  RiMoreFill,
} from '@remixicon/react'
import { PortalToFollowElem, PortalToFollowElemContent, PortalToFollowElemTrigger } from '@/app/components/base/portal-to-follow-elem'
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

  return (
    <PortalToFollowElem
      open={open}
      onOpenChange={setOpen}
      placement='bottom-end'
      offset={{
        mainAxis: 4,
        crossAxis: -4,
      }}
    >
      <PortalToFollowElemTrigger
        onClick={() => setOpen(v => !v)}
      >
        <ActionButton size='l' state={open ? ActionButtonState.Hover : ActionButtonState.Default}>
          <RiMoreFill className='h-[18px] w-[18px]' />
        </ActionButton>
      </PortalToFollowElemTrigger>
      <PortalToFollowElemContent className="z-40">
        <div
          className={'min-w-[160px] rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-bg-blur p-1 shadow-lg backdrop-blur-sm'}
        >
          <div className='system-md-regular flex cursor-pointer items-center space-x-1 rounded-lg px-3 py-1.5 text-text-secondary hover:bg-state-base-hover' onClick={handleResetChat}>
            <span className='grow'>{t('share.chat.resetChat')}</span>
          </div>
          {!hideViewChatSettings && (
            <div className='system-md-regular flex cursor-pointer items-center space-x-1 rounded-lg px-3 py-1.5 text-text-secondary hover:bg-state-base-hover' onClick={handleViewChatSettings}>
              <span className='grow'>{t('share.chat.viewChatSettings')}</span>
            </div>
          )}
        </div>
      </PortalToFollowElemContent>
    </PortalToFollowElem>

  )
}

export default MobileOperationDropdown
