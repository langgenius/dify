'use client'

import type { ThemePreference } from './theme'
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
import { useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'
import { useThemePreference } from './hooks'
import { themeOptions } from './theme'

const subscribeToNothing = () => () => {}

const useIsHydrated = () =>
  useSyncExternalStore(
    subscribeToNothing,
    () => true,
    () => false,
  )

export function ThemeSelector() {
  const direction = useDirection()
  const { t } = useTranslation(['common'])
  const { preference, setPreference } = useThemePreference()
  const isHydrated = useIsHydrated()
  const currentOption = themeOptions.find((option) => option.value === preference)

  return (
    <Menu>
      <MenuTrigger
        render={
          <IconButton
            aria-label={t(($) => $['theme.label'], { ns: 'common' })}
            size="lg"
            className="data-popup-open:bg-state-base-hover"
          >
            {isHydrated && currentOption ? (
              <span
                aria-hidden
                className={`${currentOption.iconClassName} size-4 text-text-tertiary`}
              />
            ) : (
              <span aria-hidden className="size-4" />
            )}
          </IconButton>
        }
      />
      <MenuContent dir={direction} sideOffset={6} className="w-36">
        <MenuRadioGroup<ThemePreference> value={preference} onValueChange={setPreference}>
          {themeOptions.map((option) => (
            <MenuRadioItem<ThemePreference> key={option.value} value={option.value} closeOnClick>
              <span className={`${option.iconClassName} size-4 text-text-tertiary`} />
              <span className="grow px-1 system-md-regular">
                {t(($) => $[option.labelKey], { ns: 'common' })}
              </span>
              <MenuRadioItemIndicator />
            </MenuRadioItem>
          ))}
        </MenuRadioGroup>
      </MenuContent>
    </Menu>
  )
}
