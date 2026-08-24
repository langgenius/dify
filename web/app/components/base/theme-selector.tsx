'use client'

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuRadioItemIndicator,
  DropdownMenuTrigger,
} from '@langgenius/dify-ui/dropdown-menu'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import { useTheme } from 'next-themes'
import { useTranslation } from 'react-i18next'

const THEMES = ['light', 'dark', 'system'] as const
export type Theme = (typeof THEMES)[number]

const isTheme = (value: string): value is Theme => {
  return (THEMES as readonly string[]).includes(value)
}

export default function ThemeSelector() {
  const { t } = useTranslation()
  const { theme, setTheme } = useTheme()
  const currentTheme: Theme = theme && isTheme(theme) ? theme : 'system'

  const getCurrentIcon = () => {
    switch (theme) {
      case 'light':
        return <span aria-hidden className="i-ri-sun-line size-4 text-text-tertiary" />
      case 'dark':
        return <span aria-hidden className="i-ri-moon-line size-4 text-text-tertiary" />
      default:
        return <span aria-hidden className="i-ri-computer-line size-4 text-text-tertiary" />
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <IconButton
            aria-label={t(($) => $['theme.theme'], { ns: 'common' })}
            size="lg"
            className="data-popup-open:bg-state-base-hover"
          >
            {getCurrentIcon()}
          </IconButton>
        }
      />
      <DropdownMenuContent placement="bottom-end" sideOffset={6} className="w-[144px]">
        <DropdownMenuRadioGroup<Theme>
          value={currentTheme}
          onValueChange={(nextTheme) => setTheme(nextTheme)}
        >
          <DropdownMenuRadioItem<Theme> value="light" closeOnClick>
            <span className="i-ri-sun-line size-4 text-text-tertiary" />
            <span className="grow px-1 system-md-regular">
              {t(($) => $['theme.light'], { ns: 'common' })}
            </span>
            <DropdownMenuRadioItemIndicator data-testid="light-icon" />
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem<Theme> value="dark" closeOnClick>
            <span className="i-ri-moon-line size-4 text-text-tertiary" />
            <span className="grow px-1 system-md-regular">
              {t(($) => $['theme.dark'], { ns: 'common' })}
            </span>
            <DropdownMenuRadioItemIndicator data-testid="dark-icon" />
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem<Theme> value="system" closeOnClick>
            <span className="i-ri-computer-line size-4 text-text-tertiary" />
            <span className="grow px-1 system-md-regular">
              {t(($) => $['theme.auto'], { ns: 'common' })}
            </span>
            <DropdownMenuRadioItemIndicator data-testid="system-icon" />
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
