'use client'

import { MenuItem } from '@langgenius/dify-ui/menu'
import { useTranslation } from 'react-i18next'
import { MenuItemContent } from './menu-item-content'

export default function LogoutMenuItem({ onLogout }: { onLogout?: () => void }) {
  const { t } = useTranslation(['common'])

  return (
    <MenuItem className="px-3 py-1" onClick={onLogout}>
      <MenuItemContent
        iconClassName="i-ri-shut-down-line"
        label={t(($) => $['userProfile.logout'], { ns: 'common' })}
      />
    </MenuItem>
  )
}
