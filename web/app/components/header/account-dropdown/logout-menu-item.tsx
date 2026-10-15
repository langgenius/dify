'use client'

import { DropdownMenuItem } from '@langgenius/dify-ui/dropdown-menu'
import { useTranslation } from 'react-i18next'
import { MenuItemContent } from './menu-item-content'

export default function LogoutMenuItem({ onLogout }: { onLogout?: () => void }) {
  const { t } = useTranslation(['common'])

  return (
    <DropdownMenuItem className="mx-0 px-3 py-1" onClick={onLogout}>
      <MenuItemContent
        iconClassName="i-ri-shut-down-line"
        label={t(($) => $['userProfile.logout'], { ns: 'common' })}
      />
    </DropdownMenuItem>
  )
}
