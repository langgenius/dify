'use client'

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@langgenius/dify-ui/dropdown-menu'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import { useTranslation } from 'react-i18next'

type Props = {
  name: string
  onRemove: (deleteChats: boolean) => void
}

export default function AppActionsMenu({ name, onRemove }: Props) {
  const { t } = useTranslation(['app'])
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
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
      <DropdownMenuContent className="min-w-54.5" placement="bottom-end">
        <DropdownMenuItem onClick={() => onRemove(false)}>
          {t(($) => $['endUser.removeFromList'], { ns: 'app' })}
        </DropdownMenuItem>
        <DropdownMenuItem variant="destructive" onClick={() => onRemove(true)}>
          {t(($) => $['endUser.removeAndDeleteChats'], { ns: 'app' })}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
