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
}

const MobileOperationDropdown = ({
  handleResetChat,
  handleViewChatSettings,
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
          <RiMoreFill className='w-[18px] h-[18px]' />
        </ActionButton>
      </PortalToFollowElemTrigger>
      <PortalToFollowElemContent className="z-40">
        <div
          className={'min-w-[160px] p-1 bg-components-panel-bg-blur backdrop-blur-sm rounded-xl border-[0.5px] border-components-panel-border shadow-lg'}
        >
          <div className='flex items-center space-x-1 px-3 py-1.5 rounded-lg text-text-secondary system-md-regular cursor-pointer hover:bg-state-base-hover' onClick={handleResetChat}>
            <span className='grow'>{t('share.chat.resetChat')}</span>
          </div>
          <div className='flex items-center space-x-1 px-3 py-1.5 rounded-lg text-text-secondary system-md-regular cursor-pointer hover:bg-state-base-hover' onClick={handleViewChatSettings}>
            <span className='grow'>{t('share.chat.viewChatSettings')}</span>
          </div>
        </div>
      </PortalToFollowElemContent>
    </PortalToFollowElem>

  )
}

export default MobileOperationDropdown
