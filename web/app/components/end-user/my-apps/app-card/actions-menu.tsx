'use client'

import { IconButton } from '@langgenius/dify-ui/icon-button'
import { Menu, MenuContent, MenuItem, MenuTrigger } from '@langgenius/dify-ui/menu'
import { useTranslation } from 'react-i18next'

type Props = {
  name: string
  onRemove: (deleteChats: boolean) => void
}

export default function AppActionsMenu({ name, onRemove }: Props) {
  const { t } = useTranslation(['app'])
  return (
    <Menu>
      <MenuTrigger
        render={
          <IconButton
            size="md"
            className="size-7"
            aria-label={t(($) => $['endUser.appActions'], { ns: 'app', name })}
          >
            <span className="i-ri-more-fill size-4" aria-hidden="true" />
          </IconButton>
        }
      />
      <MenuContent className="min-w-54.5" side="bottom" align="end">
        <MenuItem onClick={() => onRemove(false)}>
          {t(($) => $['endUser.removeFromList'], { ns: 'app' })}
        </MenuItem>
        <MenuItem variant="destructive" onClick={() => onRemove(true)}>
          {t(($) => $['endUser.removeAndDeleteChats'], { ns: 'app' })}
        </MenuItem>
      </MenuContent>
    </Menu>
  )
}
