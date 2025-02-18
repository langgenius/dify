import type { FC } from 'react'
import React from 'react'
import { RiRefreshLine } from '@remixicon/react'
import { useTranslation } from 'react-i18next'
import type { Theme } from './theme/theme-context'
import { CssTransform } from './theme/utils'
import Tooltip from '@/app/components/base/tooltip'

export type IHeaderProps = {
  isMobile?: boolean
  customerIcon?: React.ReactNode
  title: string
  theme?: Theme
  onCreateNewChat?: () => void
}
const Header: FC<IHeaderProps> = ({
  isMobile,
  customerIcon,
  title,
  theme,
  onCreateNewChat,
}) => {
  const { t } = useTranslation()
  if (!isMobile)
    return null

  return (
    <div
      className={`
        flex h-14 shrink-0 items-center justify-between px-4 
      `}
      style={Object.assign({}, CssTransform(theme?.backgroundHeaderColorStyle ?? ''), CssTransform(theme?.headerBorderBottomStyle ?? '')) }
    >
      <div className="flex items-center space-x-2">
        {customerIcon}
        <div
          className={'text-sm font-bold text-white'}
          style={CssTransform(theme?.colorFontOnHeaderStyle ?? '')}
        >
          {title}
        </div>
      </div>
      <Tooltip
        popupContent={t('share.chat.resetChat')}
      >
        <div className='flex h-8 w-8 cursor-pointer items-center justify-center hover:rounded-lg hover:bg-black/5' onClick={() => {
          onCreateNewChat?.()
        }}>
          <RiRefreshLine className="h-4 w-4 text-sm font-bold text-white" color={theme?.colorPathOnHeader}/>
        </div>
      </Tooltip>
    </div>
  )
}

export default React.memo(Header)
