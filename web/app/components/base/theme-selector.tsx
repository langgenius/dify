'use client'

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuRadioItemIndicator,
  DropdownMenuTrigger,
} from '@langgenius/dify-ui/dropdown-menu'
import { useTheme } from 'next-themes'
import { useTranslation } from 'react-i18next'
import ActionButton from '@/app/components/base/action-button'

export type Theme = 'light' | 'dark' | 'system'

export default function ThemeSelector() {
  const { t } = useTranslation()
  const { theme, setTheme } = useTheme()

  const handleThemeChange = (newTheme: Theme) => {
    setTheme(newTheme)
  }

  const getCurrentIcon = () => {
    switch (theme) {
      case 'light': return <span className="i-ri-sun-line h-4 w-4 text-text-tertiary" />
      case 'dark': return <span className="i-ri-moon-line h-4 w-4 text-text-tertiary" />
      default: return <span className="i-ri-computer-line h-4 w-4 text-text-tertiary" />
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={(
          <ActionButton
            aria-label={t('theme.theme', { ns: 'common' })}
            className="h-8 w-8 p-[6px] data-popup-open:bg-state-base-hover"
          />
        )}
      >
        {getCurrentIcon()}
      </DropdownMenuTrigger>
      <DropdownMenuContent placement="bottom-end" sideOffset={6} popupClassName="w-[144px]">
        <DropdownMenuRadioGroup value={theme || 'system'} onValueChange={value => handleThemeChange(value as Theme)}>
          <DropdownMenuRadioItem value="light" closeOnClick>
            <span className="i-ri-sun-line h-4 w-4 text-text-tertiary" />
            <span className="grow px-1 system-md-regular">{t('theme.light', { ns: 'common' })}</span>
            <DropdownMenuRadioItemIndicator data-testid="light-icon" />
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="dark" closeOnClick>
            <span className="i-ri-moon-line h-4 w-4 text-text-tertiary" />
            <span className="grow px-1 system-md-regular">{t('theme.dark', { ns: 'common' })}</span>
            <DropdownMenuRadioItemIndicator data-testid="dark-icon" />
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="system" closeOnClick>
            <span className="i-ri-computer-line h-4 w-4 text-text-tertiary" />
            <span className="grow px-1 system-md-regular">{t('theme.auto', { ns: 'common' })}</span>
            <DropdownMenuRadioItemIndicator data-testid="system-icon" />
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
