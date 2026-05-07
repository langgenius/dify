'use client'

import type { ReactElement, ReactNode } from 'react'
import { Avatar } from '@langgenius/dify-ui/avatar'
import { cn } from '@langgenius/dify-ui/cn'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@langgenius/dify-ui/dropdown-menu'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { resetUser } from '@/app/components/base/amplitude/utils'
import { useAppContext } from '@/context/app-context'
import { useRouter } from '@/next/navigation'
import { useLogout } from '@/service/use-common'
import AccountAbout from '../account-about'
import { DefaultMenuContent } from './default-menu-content'
import { MainNavMenuContent } from './main-nav-menu-content'

type AccountDropdownProps = {
  trigger?: (props: {
    isOpen: boolean
    ariaLabel: string
  }) => ReactElement
  mainNavBadge?: ReactNode
  variant?: 'default' | 'mainNav'
}

const mainNavMenuPopupClassName = 'w-60 max-w-80 overflow-hidden bg-components-panel-bg-blur! p-0! backdrop-blur-[5px]'

export default function AppSelector({
  mainNavBadge,
  trigger,
  variant = 'default',
}: AccountDropdownProps = {}) {
  const router = useRouter()
  const [aboutVisible, setAboutVisible] = useState(false)
  const [isAccountMenuOpen, setIsAccountMenuOpen] = useState(false)
  const { t } = useTranslation()
  const { userProfile, langGeniusVersionInfo } = useAppContext()
  const { mutateAsync: logout } = useLogout()

  const handleLogout = async () => {
    await logout()
    resetUser()
    localStorage.removeItem('setup_status')
    // Tokens are now stored in cookies and cleared by backend

    // To avoid use other account's education notice info
    localStorage.removeItem('education-reverify-prev-expire-at')
    localStorage.removeItem('education-reverify-has-noticed')
    localStorage.removeItem('education-expired-has-noticed')

    router.push('/signin')
  }

  return (
    <div>
      <DropdownMenu open={isAccountMenuOpen} onOpenChange={setIsAccountMenuOpen}>
        {trigger
          ? (
              <DropdownMenuTrigger
                render={trigger({
                  isOpen: isAccountMenuOpen,
                  ariaLabel: t('account.account', { ns: 'common' }),
                })}
              />
            )
          : (
              <DropdownMenuTrigger
                aria-label={t('account.account', { ns: 'common' })}
                className={cn('inline-flex items-center rounded-[20px] p-0.5 hover:bg-background-default-dodge', isAccountMenuOpen && 'bg-background-default-dodge')}
              >
                <Avatar avatar={userProfile.avatar_url} name={userProfile.name} size="lg" />
              </DropdownMenuTrigger>
            )}
        <DropdownMenuContent
          placement={variant === 'mainNav' ? 'top-start' : 'bottom-end'}
          sideOffset={6}
          alignOffset={variant === 'mainNav' ? 4 : 0}
          popupClassName={variant === 'mainNav' ? mainNavMenuPopupClassName : 'w-60 max-w-80 bg-components-panel-bg-blur! py-0! backdrop-blur-xs'}
        >
          {variant === 'mainNav'
            ? <MainNavMenuContent mainNavBadge={mainNavBadge} onLogout={handleLogout} />
            : (
                <DefaultMenuContent
                  closeAccountDropdown={() => setIsAccountMenuOpen(false)}
                  onShowAbout={() => setAboutVisible(true)}
                  onLogout={handleLogout}
                />
              )}
        </DropdownMenuContent>
      </DropdownMenu>
      {aboutVisible && <AccountAbout onCancel={() => setAboutVisible(false)} langGeniusVersionInfo={langGeniusVersionInfo} />}
    </div>
  )
}
