import type { FC, SVGProps } from 'react'
import React from 'react'
import { useTranslation } from 'react-i18next'
// import AppIcon from '@/app/components/base/app-icon'
import Tooltip from '@/app/components/base/tooltip'

export const ReplayIcon = ({ className }: SVGProps<SVGElement>) => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
    <path d="M1.33301 6.66667C1.33301 6.66667 2.66966 4.84548 3.75556 3.75883C4.84147 2.67218 6.34207 2 7.99967 2C11.3134 2 13.9997 4.68629 13.9997 8C13.9997 11.3137 11.3134 14 7.99967 14C5.26428 14 2.95642 12.1695 2.23419 9.66667M1.33301 6.66667V2.66667M1.33301 6.66667H5.33301" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)

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
