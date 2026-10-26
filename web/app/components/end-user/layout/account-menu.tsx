'use client'

import { Avatar, AvatarFallback } from '@langgenius/dify-ui/avatar'
import { Menu, MenuContent, MenuGroup, MenuTrigger } from '@langgenius/dify-ui/menu'
import { useTranslation } from 'react-i18next'
import LogoutMenuItem from '@/app/components/header/account-menu/logout-menu-item'
import { getAvatarInitial } from '@/utils/avatar'

const exampleName = 'Evan Z'

export default function AccountMenu() {
  const { t } = useTranslation(['app'])

  return (
    <Menu>
      <MenuTrigger
        aria-label={t(($) => $['endUser.userMenu'], { ns: 'app', name: exampleName })}
        className="flex h-10 min-w-0 flex-1 items-center gap-2 rounded-lg px-2 text-text-secondary hover:bg-state-base-hover data-popup-open:bg-state-base-hover"
      >
        <Avatar size="sm" aria-hidden>
          <AvatarFallback>{getAvatarInitial(exampleName)}</AvatarFallback>
        </Avatar>
        <span className="min-w-0 grow text-start system-sm-medium wrap-anywhere">
          {exampleName}
        </span>
      </MenuTrigger>
      <MenuContent
        side="top"
        align="start"
        sideOffset={6}
        alignOffset={4}
        className="w-60 max-w-80 overflow-hidden p-0"
      >
        <MenuGroup className="py-1">
          {/* End-user authentication is not connected in this frontend preview. */}
          <LogoutMenuItem />
        </MenuGroup>
      </MenuContent>
    </Menu>
  )
}
