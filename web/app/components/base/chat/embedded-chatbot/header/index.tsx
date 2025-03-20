import type { FC } from 'react'
import React from 'react'
import { RiResetLeftLine } from '@remixicon/react'
import { useTranslation } from 'react-i18next'
import type { Theme } from '../theme/theme-context'
import { CssTransform } from '../theme/utils'
import {
  useEmbeddedChatbotContext,
} from '../context'
import Tooltip from '@/app/components/base/tooltip'
import ActionButton from '@/app/components/base/action-button'
import Divider from '@/app/components/base/divider'
import ViewFormDropdown from '@/app/components/base/chat/embedded-chatbot/inputs-form/view-form-dropdown'
import LogoSite from '@/app/components/base/logo/logo-site'
import cn from '@/utils/classnames'

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
  const {
    appData,
    currentConversationId,
    inputsForms,
  } = useEmbeddedChatbotContext()
  if (!isMobile) {
    return (
      <div className='shrink-0 h-14 p-3 flex items-center justify-end'>
        <div className='flex items-center gap-1'>
          {/* powered by */}
          <div className='shrink-0'>
            {!appData?.custom_config?.remove_webapp_brand && (
              <div className={cn(
                'shrink-0 px-2 flex items-center gap-1.5',
              )}>
                <div className='text-text-tertiary system-2xs-medium-uppercase'>{t('share.chat.poweredBy')}</div>
                {appData?.custom_config?.replace_webapp_logo && (
                  <img src={appData?.custom_config?.replace_webapp_logo} alt='logo' className='block w-auto h-5' />
                )}
                {!appData?.custom_config?.replace_webapp_logo && (
                  <LogoSite className='!h-5' />
                )}
              </div>
            )}
          </div>
          {currentConversationId && (
            <Divider type='vertical' className='h-3.5' />
          )}
          {currentConversationId && (
            <Tooltip
              popupContent={t('share.chat.resetChat')}
            >
              <ActionButton size='l' onClick={onCreateNewChat}>
                <RiResetLeftLine className='w-[18px] h-[18px]' />
              </ActionButton>
            </Tooltip>
          )}
          {currentConversationId && inputsForms.length > 0 && (
            <ViewFormDropdown />
          )}
        </div>
      </div>
    )
  }

  return (
    <div
      className={cn('shrink-0 flex items-center justify-between h-14 px-3 rounded-t-2xl')}
      style={Object.assign({}, CssTransform(theme?.backgroundHeaderColorStyle ?? ''), CssTransform(theme?.headerBorderBottomStyle ?? '')) }
    >
      <div className="grow flex items-center space-x-3">
        {customerIcon}
        <div
          className='system-md-semibold truncate'
          style={CssTransform(theme?.colorFontOnHeaderStyle ?? '')}
        >
          {title}
        </div>
      </div>
      <div className='flex items-center gap-1'>
        {currentConversationId && (
          <Tooltip
            popupContent={t('share.chat.resetChat')}
          >
            <ActionButton size='l' onClick={onCreateNewChat}>
              <RiResetLeftLine className={cn('w-[18px] h-[18px]', theme?.colorPathOnHeader)} />
            </ActionButton>
          </Tooltip>
        )}
        {currentConversationId && inputsForms.length > 0 && (
          <ViewFormDropdown iconColor={theme?.colorPathOnHeader} />
        )}
      </div>
    </div>
  )
}

export default React.memo(Header)
