'use client'

import type { ReactElement } from 'react'
import { Avatar } from '@langgenius/dify-ui/avatar'
import { cn } from '@langgenius/dify-ui/cn'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@langgenius/dify-ui/dropdown-menu'
import { useAtomValue } from 'jotai'
import { useState, useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'
import { resetUser } from '@/app/components/base/amplitude/utils'
import {
  useSetEducationExpiredHasNoticed,
  useSetEducationReverifyHasNoticed,
  useSetEducationReverifyPrevExpireAt,
} from '@/app/education-apply/storage'
import { userProfileAtom } from '@/context/account-state'
import { langGeniusVersionInfoAtom } from '@/context/version-state'
import { useRouter } from '@/next/navigation'
import { useLogout } from '@/service/use-common'
import AccountAbout from '../account-about'
import { DefaultMenuContent } from './default-menu-content'
import { MainNavMenuContent } from './main-nav-menu-content'

type AccountDropdownProps = {
  trigger?: (props: { isOpen: boolean; ariaLabel: string }) => ReactElement
  variant?: 'default' | 'mainNav'
}

const mainNavMenuPopupClassName =
  'w-60 max-w-80 overflow-hidden bg-components-panel-bg-blur! p-0! backdrop-blur-[5px]'

const subscribeHydrationState = () => () => {}
const getHydrationSnapshot = () => false
const getServerHydrationSnapshot = () => true

export default function AppSelector({ trigger, variant = 'default' }: AccountDropdownProps = {}) {
  const router = useRouter()
  const [aboutVisible, setAboutVisible] = useState(false)
  const [isAccountMenuOpen, setIsAccountMenuOpen] = useState(false)
  const isHydrating = useSyncExternalStore(
    subscribeHydrationState,
    getHydrationSnapshot,
    getServerHydrationSnapshot,
  )
  const { t } = useTranslation()
  const userProfile = useAtomValue(userProfileAtom)
  const langGeniusVersionInfo = useAtomValue(langGeniusVersionInfoAtom)
  const clearEducationReverifyPrevExpireAt = useSetEducationReverifyPrevExpireAt()
  const clearEducationReverifyHasNoticed = useSetEducationReverifyHasNoticed()
  const clearEducationExpiredHasNoticed = useSetEducationExpiredHasNoticed()

  const { mutateAsync: logout } = useLogout()

  const handleLogout = async () => {
    await logout()
    resetUser()
    // Tokens are now stored in cookies and cleared by backend

    // To avoid use other account's education notice info
    clearEducationReverifyPrevExpireAt(null)
    clearEducationReverifyHasNoticed(null)
    clearEducationExpiredHasNoticed(null)

    router.push('/signin')
  }

  return (
    <div>
      <DropdownMenu open={isAccountMenuOpen} onOpenChange={setIsAccountMenuOpen}>
        {trigger ? (
          <DropdownMenuTrigger
            disabled={isHydrating}
            render={trigger({
              isOpen: isAccountMenuOpen,
              ariaLabel: t(($) => $['account.account'], { ns: 'common' }),
            })}
          />
        ) : (
          <DropdownMenuTrigger
            disabled={isHydrating}
            aria-label={t(($) => $['account.account'], { ns: 'common' })}
            className={cn(
              'inline-flex items-center rounded-[20px] p-0.5 hover:bg-background-default-dodge disabled:cursor-default disabled:hover:bg-transparent',
              isAccountMenuOpen && 'bg-background-default-dodge',
            )}
          >
            <Avatar avatar={userProfile.avatar_url} name={userProfile.name} size="lg" />
          </DropdownMenuTrigger>
        )}
        <DropdownMenuContent
          placement={variant === 'mainNav' ? 'top-start' : 'bottom-end'}
          sideOffset={6}
          alignOffset={variant === 'mainNav' ? 4 : 0}
          popupClassName={
            variant === 'mainNav'
              ? mainNavMenuPopupClassName
              : 'w-60 max-w-80 bg-components-panel-bg-blur! py-0! backdrop-blur-xs'
          }
        >
          {variant === 'mainNav' ? (
            <MainNavMenuContent onLogout={handleLogout} />
          ) : (
            <DefaultMenuContent
              closeAccountDropdown={() => setIsAccountMenuOpen(false)}
              onShowAbout={() => setAboutVisible(true)}
              onLogout={handleLogout}
            />
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      {aboutVisible && (
        <AccountAbout
          onCancel={() => setAboutVisible(false)}
          langGeniusVersionInfo={langGeniusVersionInfo}
        />
      )}
    </div>
  )
}
