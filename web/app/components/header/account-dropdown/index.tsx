'use client'

import type { ReactElement } from 'react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@langgenius/dify-ui/dropdown-menu'
import { useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'
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
  const isHydrating = useSyncExternalStore(
    subscribeHydrationState,
    getHydrationSnapshot,
    getServerHydrationSnapshot,
  )
  const { t } = useTranslation(['accountSettings'])

  const { mutate: logout } = useLogout()

  return (
    <div>
      <DropdownMenu>
        <DropdownMenuTrigger
          disabled={isHydrating}
          render={trigger({
            ariaLabel: t(($) => $['account.account'], { ns: 'accountSettings' }),
          })}
        />
        <DropdownMenuContent
          placement="top-start"
          sideOffset={6}
          alignOffset={4}
          className={mainNavMenuPopupClassName}
        >
          <MainNavMenuContent onLogout={() => logout()} />
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
