'use client'

import type { ReactNode } from 'react'
import type { Theme } from '@/app/components/base/theme-selector'
import type { Locale } from '@/i18n-config'
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
import { toast } from '@langgenius/dify-ui/toast'
import { useTheme } from 'next-themes'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useAppContext } from '@/context/app-context'
import { useLocale } from '@/context/i18n'
import { setLocaleOnClient } from '@/i18n-config'
import { languages } from '@/i18n-config/language'
import Link from '@/next/link'
import { useRouter } from '@/next/navigation'
import { updateUserProfile } from '@/service/common'
import { timezones } from '@/utils/timezone'
import { ExternalLinkIndicator, MenuItemContent } from './menu-item-content'

const mainNavMenuGroupClassName = 'p-1'
const mainNavMenuItemClassName = 'mx-0 h-8 gap-1 px-3 py-1'
const mainNavMenuSubPopupClassName = 'w-60 max-h-[360px] bg-components-panel-bg-blur! p-1! backdrop-blur-[5px]'

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
      <DropdownMenuSubTrigger className={mainNavMenuItemClassName}>
        <MenuItemContent
          iconClassName="i-ri-sun-line"
          label={t('account.appearanceLabel', { ns: 'common' })}
        />
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent
        placement="right-start"
        sideOffset={6}
        popupClassName={mainNavMenuSubPopupClassName}
      >
        <DropdownMenuRadioGroup value={theme || 'system'} onValueChange={value => setTheme(value as Theme)}>
          <DropdownMenuRadioItem value="light" closeOnClick className={mainNavMenuItemClassName}>
            <MainNavRadioItemContent iconClassName="i-ri-sun-line" label={t('account.appearanceLight', { ns: 'common' })} />
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="dark" closeOnClick className={mainNavMenuItemClassName}>
            <MainNavRadioItemContent iconClassName="i-ri-moon-line" label={t('account.appearanceDark', { ns: 'common' })} />
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="system" closeOnClick className={mainNavMenuItemClassName}>
            <MainNavRadioItemContent iconClassName="i-ri-computer-line" label={t('account.appearanceSystem', { ns: 'common' })} />
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  )
}

function LanguageSubmenu() {
  const locale = useLocale()
  const router = useRouter()
  const { t } = useTranslation()
  const { userProfile, mutateUserProfile } = useAppContext()
  const [editing, setEditing] = useState(false)
  const languageOptions = languages.filter(item => item.supported)
  const selectedLanguage = locale || userProfile.interface_language
  const selectedTimezone = userProfile.timezone

  const handleSelectLanguage = async (value: string) => {
    setEditing(true)
    try {
      await updateUserProfile({ url: '/account/interface-language', body: { interface_language: value } })
      toast.success(t('actionMsg.modifiedSuccessfully', { ns: 'common' }))
      await setLocaleOnClient(value as Locale, false)
      router.refresh()
    }
    catch (error) {
      toast.error((error as Error).message)
    }
    finally {
      setEditing(false)
    }
  }

  const handleSelectTimezone = async (value: string) => {
    setEditing(true)
    try {
      await updateUserProfile({ url: '/account/timezone', body: { timezone: value } })
      toast.success(t('actionMsg.modifiedSuccessfully', { ns: 'common' }))
      mutateUserProfile()
    }
    catch (error) {
      toast.error((error as Error).message)
    }
    finally {
      setEditing(false)
    }
  }

  return (
    <>
      <DropdownMenuSub>
        <DropdownMenuSubTrigger className={mainNavMenuItemClassName}>
          <MenuItemContent
            iconClassName="i-ri-translate-2"
            label={t('language.language', { ns: 'common' })}
          />
        </DropdownMenuSubTrigger>
        <DropdownMenuSubContent
          placement="right-start"
          sideOffset={6}
          popupClassName={mainNavMenuSubPopupClassName}
        >
          <DropdownMenuRadioGroup
            value={selectedLanguage}
            onValueChange={(value) => {
              if (!editing)
                void handleSelectLanguage(value)
            }}
          >
            {languageOptions.map(item => (
              <DropdownMenuRadioItem key={item.value} value={item.value} closeOnClick className={mainNavMenuItemClassName}>
                <MainNavRadioItemContent label={item.name} />
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuSubContent>
      </DropdownMenuSub>
      <DropdownMenuSub>
        <DropdownMenuSubTrigger className={mainNavMenuItemClassName}>
          <MenuItemContent
            iconClassName="i-ri-global-line"
            label={t('language.timezone', { ns: 'common' })}
          />
        </DropdownMenuSubTrigger>
        <DropdownMenuSubContent
          placement="right-start"
          sideOffset={6}
          popupClassName={mainNavMenuSubPopupClassName}
        >
          <DropdownMenuRadioGroup
            value={selectedTimezone}
            onValueChange={(value) => {
              if (!editing)
                void handleSelectTimezone(value)
            }}
          >
            {timezones.map(item => (
              <DropdownMenuRadioItem key={item.value} value={String(item.value)} closeOnClick className={mainNavMenuItemClassName}>
                <MainNavRadioItemContent label={item.name} />
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuSubContent>
      </DropdownMenuSub>
    </>
  )
}

type MainNavMenuContentProps = {
  mainNavBadge?: ReactNode
  onLogout: () => Promise<void>
}

export function MainNavMenuContent({
  mainNavBadge,
  onLogout,
}: MainNavMenuContentProps) {
  const { t } = useTranslation()
  const { userProfile } = useAppContext()

  return (
    <>
      <DropdownMenuGroup className={mainNavMenuGroupClassName}>
        <div className="flex items-center gap-1 rounded-xl bg-gradient-to-b from-background-section-burn to-background-section p-3">
          <div className="flex min-w-0 grow flex-col gap-1">
            <div className="flex min-w-0 items-center gap-1">
              <div className="max-w-[80px] min-w-0 truncate body-md-medium text-text-primary" title={userProfile.name}>{userProfile.name}</div>
              {mainNavBadge}
            </div>
            <div className="truncate system-xs-regular text-text-tertiary" title={userProfile.email}>{userProfile.email}</div>
          </div>
          <Avatar avatar={userProfile.avatar_url} name={userProfile.name} size="lg" />
        </div>
      </DropdownMenuGroup>
      <DropdownMenuGroup className={mainNavMenuGroupClassName}>
        <DropdownMenuLinkItem
          className={cn('justify-between', mainNavMenuItemClassName)}
          render={<Link href="/account" />}
        >
          <MenuItemContent
            iconClassName="i-ri-account-circle-line"
            label={t('account.account', { ns: 'common' })}
            trailing={<ExternalLinkIndicator />}
          />
        </DropdownMenuLinkItem>
        <AppearanceSubmenu />
        <LanguageSubmenu />
      </DropdownMenuGroup>
      <DropdownMenuSeparator className="my-0! bg-divider-subtle" />
      <DropdownMenuGroup className={mainNavMenuGroupClassName}>
        <DropdownMenuItem
          className={mainNavMenuItemClassName}
          onClick={() => {
            void onLogout()
          }}
        >
          <MenuItemContent
            iconClassName="i-ri-logout-box-r-line"
            label={t('userProfile.logout', { ns: 'common' })}
          />
        </DropdownMenuItem>
      </DropdownMenuGroup>
    </>
  )
}
