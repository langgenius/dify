import type { FC } from 'react'
import React from 'react'
import { useTranslation } from 'react-i18next'
// import AppIcon from '@/app/components/base/app-icon'
import { ReplayIcon } from '@/app/components/app/chat/icon-component'
import Tooltip from '@/app/components/base/tooltip'

export type IHeaderProps = {
  isMobile?: boolean
  customerIcon?: React.ReactNode
  title: string
  // icon: string
  // icon_background: string
  onCreateNewChat?: () => void
}
const Header: FC<IHeaderProps> = ({
  isMobile,
  customerIcon,
  title,
  // icon,
  // icon_background,
  onCreateNewChat,
}) => {
  const { t } = useTranslation()
  if (!isMobile)
    return null

  return (
    <div
      className={`
        shrink-0 flex items-center justify-between h-14 px-4 bg-gray-100 
        bg-gradient-to-r from-blue-600 to-sky-500
      `}
    >
      <div className="flex items-center space-x-2">
        {customerIcon}
        <div
          className={'text-sm font-bold text-white'}
        >
          {title}
        </div>
      </div>
      <Tooltip
        selector={'embed-scene-restart-button'}
        htmlContent={t('share.chat.resetChat')}
        position='top'
      >
        <div className='flex cursor-pointer hover:rounded-lg hover:bg-black/5 w-8 h-8 items-center justify-center' onClick={() => {
          onCreateNewChat?.()
        }}>
          <ReplayIcon className="h-4 w-4 text-sm font-bold text-white" />
        </div>
      </Tooltip>
    </div>
  )
}

export default React.memo(Header)
