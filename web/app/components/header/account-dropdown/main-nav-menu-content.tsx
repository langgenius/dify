'use client'

import type { ReactNode } from 'react'
import type { Theme } from '@/app/components/base/theme-selector'
import { Avatar } from '@langgenius/dify-ui/avatar'
import { cn } from '@langgenius/dify-ui/cn'
import {
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLinkItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuRadioItemIndicator,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from '@langgenius/dify-ui/dropdown-menu'
import { useQuery, useSuspenseQuery } from '@tanstack/react-query'
import { useTheme } from 'next-themes'
import { useQueryState } from 'nuqs'
import { useTranslation } from 'react-i18next'
import PremiumBadge from '@/app/components/base/premium-badge'
import {
  settingsQueryParamName,
  settingsQueryParser,
} from '@/app/components/header/account-setting/query-params'
import { useProviderContext } from '@/context/provider-context'
import { userProfileQueryOptions } from '@/features/account-profile/client'
import Link from '@/next/link'
import { consoleQuery } from '@/service/client'
import { ExternalLinkIndicator, MenuItemContent } from './menu-item-content'

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
      <DropdownMenuRadioItemIndicator />
    </>
  )
}

function AppearanceSubmenu() {
  const { t } = useTranslation()
  const { theme, setTheme } = useTheme()
  const currentTheme: Theme =
    theme === 'light' || theme === 'dark' || theme === 'system' ? theme : 'system'

  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger className="mx-0 h-8 gap-1 px-3 py-1">
        <MenuItemContent
          iconClassName="i-ri-sun-line"
          label={t(($) => $['account.appearanceLabel'], { ns: 'common' })}
        />
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent
        placement="right-start"
        sideOffset={6}
        className="max-h-[360px] w-[139px] bg-components-panel-bg-blur p-1 backdrop-blur-[5px]"
      >
        <DropdownMenuRadioGroup<Theme>
          value={currentTheme}
          onValueChange={(nextTheme) => setTheme(nextTheme)}
        >
          <DropdownMenuRadioItem<Theme>
            value="light"
            closeOnClick
            className="mx-0 h-8 gap-1 px-2 py-1"
          >
            <MainNavRadioItemContent
              iconClassName="i-ri-sun-line"
              label={t(($) => $['account.appearanceLight'], { ns: 'common' })}
            />
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem<Theme>
            value="dark"
            closeOnClick
            className="mx-0 h-8 gap-1 px-2 py-1"
          >
            <MainNavRadioItemContent
              iconClassName="i-ri-moon-line"
              label={t(($) => $['account.appearanceDark'], { ns: 'common' })}
            />
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem<Theme>
            value="system"
            closeOnClick
            className="mx-0 h-8 gap-1 px-2 py-1"
          >
            <MainNavRadioItemContent
              iconClassName="i-ri-computer-line"
              label={t(($) => $['account.appearanceSystem'], { ns: 'common' })}
            />
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  )
}

type MainNavMenuContentProps = {
  onLogout: () => Promise<void>
}

export function MainNavMenuContent({ onLogout }: MainNavMenuContentProps) {
  const { t } = useTranslation()
  const { data: userProfile } = useSuspenseQuery({
    ...userProfileQueryOptions(),
    select: (data) => data.profile,
  })
  const { enableEducationPlan } = useProviderContext()
  const { data: isEducationAccount = false } = useQuery(
    consoleQuery.account.education.get.queryOptions({
      enabled: enableEducationPlan,
      select: ({ is_student }) => is_student ?? false,
    }),
  )
  const [, setSettingsDestination] = useQueryState(settingsQueryParamName, settingsQueryParser)

  return (
    <>
      <DropdownMenuGroup className="p-1">
        <div className="flex items-center gap-3 rounded-xl bg-linear-to-b from-background-section-burn to-background-section p-3">
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
                  <span aria-hidden className="mr-1 i-ri-graduation-cap-fill h-3 w-3" />
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
          <Avatar
            avatar={userProfile.avatar_url}
            name={userProfile.name}
            size="lg"
            className="shrink-0"
          />
        </div>
      </DropdownMenuGroup>
      <DropdownMenuGroup className="p-1">
        <DropdownMenuLinkItem
          className="mx-0 h-8 justify-between gap-1 px-3 py-1"
          render={<Link href="/account" />}
        >
          <MenuItemContent
            iconClassName="i-ri-account-circle-line"
            label={t(($) => $['account.account'], { ns: 'common' })}
            trailing={<ExternalLinkIndicator />}
          />
        </DropdownMenuLinkItem>
        <DropdownMenuItem
          className="mx-0 h-8 gap-1 px-3 py-1"
          onClick={() => setSettingsDestination('preferences')}
        >
          <MenuItemContent
            iconClassName="i-ri-equalizer-2-line"
            label={t(($) => $['settings.preferences'], { ns: 'common' })}
          />
        </DropdownMenuItem>
        <AppearanceSubmenu />
      </DropdownMenuGroup>
      <DropdownMenuSeparator className="my-0! bg-divider-subtle" />
      <DropdownMenuGroup className="p-1">
        <DropdownMenuItem
          className="mx-0 h-8 gap-1 px-3 py-1"
          onClick={() => {
            void onLogout()
          }}
        >
          <MenuItemContent
            iconClassName="i-ri-shut-down-line"
            label={t(($) => $['userProfile.logout'], { ns: 'common' })}
          />
        </DropdownMenuItem>
      </DropdownMenuGroup>
    </>
  )
}
