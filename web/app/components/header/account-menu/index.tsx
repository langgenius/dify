'use client'

import type { ReactElement, ReactNode } from 'react'
import type { Theme } from '@/app/components/base/theme-selector'
import { Avatar, AvatarFallback, AvatarImage } from '@langgenius/dify-ui/avatar'
import { cn } from '@langgenius/dify-ui/cn'
import {
  Menu,
  MenuContent,
  MenuGroup,
  MenuItem,
  MenuLinkItem,
  MenuRadioGroup,
  MenuRadioItem,
  MenuRadioItemIndicator,
  MenuSeparator,
  MenuSubmenu,
  MenuSubmenuTrigger,
  MenuTrigger,
} from '@langgenius/dify-ui/menu'
import { useQuery, useSuspenseQuery } from '@tanstack/react-query'
import { useTheme } from 'next-themes'
import { useQueryState } from 'nuqs'
import { useRef, useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'
import PremiumBadge from '@/app/components/base/premium-badge'
import {
  settingsQueryParamName,
  settingsQueryParser,
} from '@/app/components/header/account-setting/query-params'
import { userProfileQueryOptions } from '@/features/account-profile/client'
import Link from '@/next/link'
import { consoleQuery } from '@/service/console'
import { useLogout } from '@/service/use-common'
import { getAvatarInitial } from '@/utils/avatar'
import { ExternalLinkIndicator, MenuItemContent } from './menu-item-content'

type AccountMenuProps = {
  trigger: (props: { ariaLabel: string }) => ReactElement
}

const mainNavMenuPopupClassName = 'w-60 max-w-80 overflow-hidden p-0'

const subscribeHydrationState = () => () => {}
const getHydrationSnapshot = () => false
const getServerHydrationSnapshot = () => true

type MainNavRadioItemContentProps = {
  iconClassName?: string
  label: ReactNode
}

function MainNavRadioItemContent({ iconClassName, label }: MainNavRadioItemContentProps) {
  const labelTitle = typeof label === 'string' ? label : undefined

  return (
    <>
      {iconClassName && (
        <span aria-hidden className={cn('size-4 shrink-0 text-text-tertiary', iconClassName)} />
      )}
      <span
        className="min-w-0 grow truncate px-1 system-md-regular text-text-secondary"
        title={labelTitle}
      >
        {label}
      </span>
      <MenuRadioItemIndicator />
    </>
  )
}

function AppearanceSubmenu() {
  const { t } = useTranslation(['accountSettings'])
  const { theme, setTheme } = useTheme()
  const currentTheme: Theme =
    theme === 'light' || theme === 'dark' || theme === 'system' ? theme : 'system'

  return (
    <MenuSubmenu>
      <MenuSubmenuTrigger className="px-3 py-1">
        <MenuItemContent
          iconClassName="i-ri-sun-line"
          label={t(($) => $['account.appearanceLabel'], { ns: 'accountSettings' })}
        />
      </MenuSubmenuTrigger>
      <MenuContent className="max-h-90 w-34.75">
        <MenuRadioGroup<Theme>
          value={currentTheme}
          onValueChange={(nextTheme) => setTheme(nextTheme)}
        >
          <MenuRadioItem<Theme> value="light" className="py-1">
            <MainNavRadioItemContent
              iconClassName="i-ri-sun-line"
              label={t(($) => $['account.appearanceLight'], { ns: 'accountSettings' })}
            />
          </MenuRadioItem>
          <MenuRadioItem<Theme> value="dark" className="py-1">
            <MainNavRadioItemContent
              iconClassName="i-ri-moon-line"
              label={t(($) => $['account.appearanceDark'], { ns: 'accountSettings' })}
            />
          </MenuRadioItem>
          <MenuRadioItem<Theme> value="system" className="py-1">
            <MainNavRadioItemContent
              iconClassName="i-ri-computer-line"
              label={t(($) => $['account.appearanceSystem'], { ns: 'accountSettings' })}
            />
          </MenuRadioItem>
        </MenuRadioGroup>
      </MenuContent>
    </MenuSubmenu>
  )
}

type MainNavMenuContentProps = {
  onLogout: () => void
}

function MainNavMenuContent({ onLogout }: MainNavMenuContentProps) {
  const { t } = useTranslation(['common', 'accountSettings', 'navigation'])
  const { data: userProfile } = useSuspenseQuery({
    ...userProfileQueryOptions(),
    select: (data) => data.profile,
  })
  const { data: enableEducationPlan } = useQuery(
    consoleQuery.features.get.queryOptions({
      select: (features) => features.education.enabled,
    }),
  )
  const { data: isEducationAccount = false } = useQuery(
    consoleQuery.account.education.get.queryOptions({
      enabled: enableEducationPlan === true,
      select: ({ is_student }) => is_student ?? false,
    }),
  )
  const [, setSettingsDestination] = useQueryState(settingsQueryParamName, settingsQueryParser)

  return (
    <>
      <MenuGroup className="py-1">
        <div className="mx-1 flex items-center gap-3 rounded-xl bg-linear-to-b from-background-section-burn to-background-section p-3">
          <div className="flex min-w-0 grow flex-col gap-1">
            <div className="flex min-w-0 items-center gap-1">
              <div
                className="min-w-0 flex-1 truncate body-md-medium text-text-primary"
                title={userProfile.name}
              >
                {userProfile.name}
              </div>
              {isEducationAccount && (
                <PremiumBadge size="s" color="blue" className="shrink-0 px-2!">
                  <span aria-hidden className="me-1 i-ri-graduation-cap-fill size-3" />
                  <span className="system-2xs-medium">EDU</span>
                </PremiumBadge>
              )}
            </div>
            <div
              className="truncate system-xs-regular text-text-tertiary"
              title={userProfile.email}
            >
              {userProfile.email}
            </div>
          </div>
          <Avatar size="lg" className="shrink-0" aria-hidden="true">
            <AvatarFallback>{getAvatarInitial(userProfile.name)}</AvatarFallback>
            <AvatarImage src={userProfile.avatar_url || undefined} alt="" />
          </Avatar>
        </div>
      </MenuGroup>
      <MenuGroup className="py-1">
        <MenuLinkItem className="justify-between px-3 py-1" render={<Link href="/account" />}>
          <MenuItemContent
            iconClassName="i-ri-account-circle-line"
            label={t(($) => $['account.account'], { ns: 'accountSettings' })}
            trailing={<ExternalLinkIndicator />}
          />
        </MenuLinkItem>
        <MenuItem className="px-3 py-1" onClick={() => setSettingsDestination('preferences')}>
          <MenuItemContent
            iconClassName="i-ri-equalizer-2-line"
            label={t(($) => $['settings.preferences'], { ns: 'navigation' })}
          />
        </MenuItem>
        <AppearanceSubmenu />
      </MenuGroup>
      <MenuSeparator className="my-0" />
      <MenuGroup className="py-1">
        <MenuItem
          className="px-3 py-1"
          onClick={() => {
            onLogout()
          }}
        >
          <MenuItemContent
            iconClassName="i-ri-shut-down-line"
            label={t(($) => $['userProfile.logout'], { ns: 'common' })}
          />
        </MenuItem>
      </MenuGroup>
    </>
  )
}

export default function AccountMenu({ trigger }: AccountMenuProps) {
  const triggerRef = useRef<HTMLButtonElement>(null)
  const popupRef = useRef<HTMLDivElement>(null)
  const keyboardNavigationRef = useRef(false)
  const isHydrating = useSyncExternalStore(
    subscribeHydrationState,
    getHydrationSnapshot,
    getServerHydrationSnapshot,
  )
  const { t } = useTranslation(['accountSettings'])

  const { mutate: logout } = useLogout()

  return (
    <div>
      <Menu
        onOpenChange={(open, { event }) => {
          if (open)
            keyboardNavigationRef.current =
              event.type.startsWith('key') ||
              (event.type === 'click' && 'detail' in event && event.detail === 0)
        }}
      >
        <MenuTrigger
          ref={triggerRef}
          onKeyDownCapture={(event) => {
            if (event.key !== 'Escape') keyboardNavigationRef.current = true
          }}
          disabled={isHydrating}
          render={trigger({
            ariaLabel: t(($) => $['account.account'], { ns: 'accountSettings' }),
          })}
        />
        <MenuContent
          ref={popupRef}
          onKeyDownCapture={(event) => {
            if (event.key !== 'Escape') keyboardNavigationRef.current = true
          }}
          finalFocus={(interactionType) => {
            const canRestoreFocus = () => {
              const activeElement = document.activeElement
              return (
                activeElement === document.body ||
                activeElement === triggerRef.current ||
                !!popupRef.current?.contains(activeElement)
              )
            }
            if (
              interactionType === 'touch' ||
              interactionType === '' ||
              (interactionType === 'keyboard' && keyboardNavigationRef.current)
            )
              return canRestoreFocus()
            // Restore after dismissal, respecting focus moved into a destination dialog.
            queueMicrotask(() => {
              if (!canRestoreFocus()) return
              const triggerElement = triggerRef.current
              // Focusing an already focused element does not update its focus-visible state.
              if (
                document.activeElement === triggerElement &&
                triggerElement?.matches(':focus-visible')
              )
                triggerElement.blur()
              triggerElement?.focus({ preventScroll: true, focusVisible: false })
            })
            return false
          }}
          side="top"
          align="start"

          alignOffset={4}
          className={mainNavMenuPopupClassName}
        >
          <MainNavMenuContent onLogout={() => logout()} />
        </MenuContent>
      </Menu>
    </div>
  )
}
