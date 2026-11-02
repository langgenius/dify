'use client'

import { useDirection } from '@langgenius/dify-ui/direction-provider'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import {
  Menu,
  MenuContent,
  MenuRadioGroup,
  MenuRadioItem,
  MenuRadioItemIndicator,
  MenuTrigger,
} from '@langgenius/dify-ui/menu'
import { useTheme } from 'next-themes'
import { useTranslation } from 'react-i18next'

const THEMES = ['light', 'dark', 'system'] as const
export type Theme = (typeof THEMES)[number]

const isTheme = (value: string): value is Theme => {
  return (THEMES as readonly string[]).includes(value)
}

export default function ThemeSelector() {
  const direction = useDirection()
  const { t } = useTranslation(['common'])
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
    <Menu>
      <MenuTrigger
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
      <MenuContent dir={direction} sideOffset={6} className="w-36">
        <MenuRadioGroup<Theme>
          value={currentTheme}
          onValueChange={(nextTheme) => setTheme(nextTheme)}
        >
          <MenuRadioItem<Theme> value="light" closeOnClick>
            <span className="i-ri-sun-line size-4 text-text-tertiary" />
            <span className="grow px-1 system-md-regular">
              {t(($) => $['theme.light'], { ns: 'common' })}
            </span>
            <MenuRadioItemIndicator data-testid="light-icon" />
          </MenuRadioItem>
          <MenuRadioItem<Theme> value="dark" closeOnClick>
            <span className="i-ri-moon-line size-4 text-text-tertiary" />
            <span className="grow px-1 system-md-regular">
              {t(($) => $['theme.dark'], { ns: 'common' })}
            </span>
            <MenuRadioItemIndicator data-testid="dark-icon" />
          </MenuRadioItem>
          <MenuRadioItem<Theme> value="system" closeOnClick>
            <span className="i-ri-computer-line size-4 text-text-tertiary" />
            <span className="grow px-1 system-md-regular">
              {t(($) => $['theme.auto'], { ns: 'common' })}
            </span>
            <MenuRadioItemIndicator data-testid="system-icon" />
          </MenuRadioItem>
        </MenuRadioGroup>
      </MenuContent>
    </Menu>
  )
}
