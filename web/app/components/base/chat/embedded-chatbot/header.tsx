import type { FC } from 'react'
import React from 'react'
import { RiRefreshLine } from '@remixicon/react'
import { useTranslation } from 'react-i18next'
import Tooltip from '@/app/components/base/tooltip'
import { useThemeContext } from './theme/theme-context'
import { CssTransform } from './theme/utils'

export type IHeaderProps = {
  isMobile?: boolean
  customerIcon?: React.ReactNode
  title: string
  onCreateNewChat?: () => void
}
const Header: FC<IHeaderProps> = ({
  isMobile,
  customerIcon,
  title,
  onCreateNewChat,
}) => {
  const { t } = useTranslation()
  const themeBuilder = useThemeContext()
  if (!isMobile)
    return null

  return (
    <div
      className={`
        shrink-0 flex items-center justify-between h-14 px-4 
      `}
      style={Object.assign({}, CssTransform(themeBuilder.theme?.backgroundHeaderColorStyle ?? ''), CssTransform(themeBuilder.theme?.headerBorderBottomStyle ?? '')) }
    >
      <div className="flex items-center space-x-2">
        {customerIcon}
        <div
          className={'text-sm font-bold text-white'}
          style={CssTransform(themeBuilder.theme?.colorFontOnHeaderStyle ?? '')}
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
          <RiRefreshLine className="h-4 w-4 text-sm font-bold text-white" color={themeBuilder.theme?.colorPathOnHeader}/>
        </div>
      </Tooltip>
    </div>
  )
}

export default React.memo(Header)
