'use client'

import type { ReactElement } from 'react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@langgenius/dify-ui/dropdown-menu'
import { useState, useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'
import { resetUser } from '@/app/components/base/amplitude/utils'
import { useRouter } from '@/next/navigation'
import { useLogout } from '@/service/use-common'
import { MainNavMenuContent } from './main-nav-menu-content'

type AccountDropdownProps = {
  trigger: (props: { ariaLabel: string }) => ReactElement
}

const mainNavMenuPopupClassName =
  'w-60 max-w-80 overflow-hidden bg-components-panel-bg-blur! p-0! backdrop-blur-[5px]'

const subscribeHydrationState = () => () => {}
const getHydrationSnapshot = () => false
const getServerHydrationSnapshot = () => true

export default function AccountDropdown({ trigger }: AccountDropdownProps) {
  const router = useRouter()
  const [isAccountMenuOpen, setIsAccountMenuOpen] = useState(false)
  const isHydrating = useSyncExternalStore(
    subscribeHydrationState,
    getHydrationSnapshot,
    getServerHydrationSnapshot,
  )
  const { t } = useTranslation()

  const { mutateAsync: logout } = useLogout()

  const handleLogout = async () => {
    await logout()
    resetUser()
    // Tokens are now stored in cookies and cleared by backend

    router.push('/signin')
  }

  return (
    <div>
      <DropdownMenu open={isAccountMenuOpen} onOpenChange={setIsAccountMenuOpen}>
        <DropdownMenuTrigger
          disabled={isHydrating}
          render={trigger({
            ariaLabel: t(($) => $['account.account'], { ns: 'common' }),
          })}
        />
        <DropdownMenuContent
          placement="top-start"
          sideOffset={6}
          alignOffset={4}
          className={mainNavMenuPopupClassName}
        >
          <MainNavMenuContent onLogout={handleLogout} />
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
