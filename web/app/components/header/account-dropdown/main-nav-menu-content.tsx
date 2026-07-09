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
import { useAtomValue } from 'jotai'
import { useTheme } from 'next-themes'
import { useTranslation } from 'react-i18next'
import PremiumBadge from '@/app/components/base/premium-badge'
import { ACCOUNT_SETTING_TAB } from '@/app/components/header/account-setting/constants'
import { userProfileAtom } from '@/context/account-state'
import { useModalContext } from '@/context/modal-context'
import { useProviderContext } from '@/context/provider-context'
import Link from '@/next/link'
import { ExternalLinkIndicator, MenuItemContent } from './menu-item-content'

type MainNavRadioItemContentProps = {
  iconClassName?: string
  label: ReactNode
}

function MainNavRadioItemContent({
  iconClassName,
  label,
}: MainNavRadioItemContentProps) {
  const labelTitle = typeof label === 'string' ? label : undefined

  return (
    <>
      {iconClassName && <span aria-hidden className={cn('size-4 shrink-0 text-text-tertiary', iconClassName)} />}
      <span className="min-w-0 grow truncate px-1 system-md-regular text-text-secondary" title={labelTitle}>{label}</span>
      <DropdownMenuRadioItemIndicator />
    </>
  )
}

function AppearanceSubmenu() {
  const { t } = useTranslation()
  const { theme, setTheme } = useTheme()

  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger className="mx-0 h-8 gap-1 px-3 py-1">
        <MenuItemContent
          iconClassName="i-ri-sun-line"
          label={t('account.appearanceLabel', { ns: 'common' })}
        />
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent
        placement="right-start"
        sideOffset={6}
        popupClassName="w-[139px] max-h-[360px] bg-components-panel-bg-blur p-1 backdrop-blur-[5px]"
      >
        <DropdownMenuRadioGroup value={theme || 'system'} onValueChange={value => setTheme(value as Theme)}>
          <DropdownMenuRadioItem value="light" closeOnClick className="mx-0 h-8 gap-1 px-2 py-1">
            <MainNavRadioItemContent iconClassName="i-ri-sun-line" label={t('account.appearanceLight', { ns: 'common' })} />
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="dark" closeOnClick className="mx-0 h-8 gap-1 px-2 py-1">
            <MainNavRadioItemContent iconClassName="i-ri-moon-line" label={t('account.appearanceDark', { ns: 'common' })} />
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="system" closeOnClick className="mx-0 h-8 gap-1 px-2 py-1">
            <MainNavRadioItemContent iconClassName="i-ri-computer-line" label={t('account.appearanceSystem', { ns: 'common' })} />
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  )
}

type MainNavMenuContentProps = {
  onLogout: () => Promise<void>
}

export function MainNavMenuContent({
  onLogout,
}: MainNavMenuContentProps) {
  const { t } = useTranslation()
  const userProfile = useAtomValue(userProfileAtom)
  const { isEducationAccount } = useProviderContext()
  const { setShowAccountSettingModal } = useModalContext()

  return (
    <>
      <DropdownMenuGroup className="p-1">
        <div className="flex items-center gap-3 rounded-xl bg-gradient-to-b from-background-section-burn to-background-section p-3">
          <div className="flex min-w-0 grow flex-col gap-1">
            <div className="flex min-w-0 items-center gap-1">
              <div className="min-w-0 flex-1 truncate body-md-medium text-text-primary" title={userProfile.name}>{userProfile.name}</div>
              {isEducationAccount && (
                <PremiumBadge size="s" color="blue" className="shrink-0 px-2!">
                  <span aria-hidden className="mr-1 i-ri-graduation-cap-fill h-3 w-3" />
                  <span className="system-2xs-medium">EDU</span>
                </PremiumBadge>
              )}
            </div>
            <div className="truncate system-xs-regular text-text-tertiary" title={userProfile.email}>{userProfile.email}</div>
          </div>
          <Avatar avatar={userProfile.avatar_url} name={userProfile.name} size="lg" className="shrink-0" />
        </div>
      </DropdownMenuGroup>
      <DropdownMenuGroup className="p-1">
        <DropdownMenuLinkItem
          className="mx-0 h-8 justify-between gap-1 px-3 py-1"
          render={<Link href="/account" />}
        >
          <MenuItemContent
            iconClassName="i-ri-account-circle-line"
            label={t('account.account', { ns: 'common' })}
            trailing={<ExternalLinkIndicator />}
          />
        </DropdownMenuLinkItem>
        <DropdownMenuItem
          className="mx-0 h-8 gap-1 px-3 py-1"
          onClick={() => setShowAccountSettingModal({ payload: ACCOUNT_SETTING_TAB.PREFERENCES })}
        >
          <MenuItemContent
            iconClassName="i-ri-equalizer-2-line"
            label={t('settings.preferences', { ns: 'common' })}
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
            label={t('userProfile.logout', { ns: 'common' })}
          />
        </DropdownMenuItem>
      </DropdownMenuGroup>
    </>
  )
}
