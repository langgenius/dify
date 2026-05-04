'use client'

import type { MouseEventHandler, ReactElement, ReactNode } from 'react'
import type { Theme } from '@/app/components/base/theme-selector'
import type { Locale } from '@/i18n-config'
import { Avatar } from '@langgenius/dify-ui/avatar'
import { cn } from '@langgenius/dify-ui/cn'
import {
  DropdownMenu,
  DropdownMenuContent,
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
  DropdownMenuTrigger,
} from '@langgenius/dify-ui/dropdown-menu'
import { toast } from '@langgenius/dify-ui/toast'
import { useSuspenseQuery } from '@tanstack/react-query'
import { useTheme } from 'next-themes'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { resetUser } from '@/app/components/base/amplitude/utils'
import PremiumBadge from '@/app/components/base/premium-badge'
import ThemeSwitcher from '@/app/components/base/theme-switcher'
import { ACCOUNT_SETTING_TAB } from '@/app/components/header/account-setting/constants'
import { IS_CLOUD_EDITION } from '@/config'
import { useAppContext } from '@/context/app-context'
import { useDocLink, useLocale } from '@/context/i18n'
import { useModalContext } from '@/context/modal-context'
import { useProviderContext } from '@/context/provider-context'
import { env } from '@/env'
import { setLocaleOnClient } from '@/i18n-config'
import { languages } from '@/i18n-config/language'
import Link from '@/next/link'
import { useRouter } from '@/next/navigation'
import { updateUserProfile } from '@/service/common'
import { systemFeaturesQueryOptions } from '@/service/system-features'
import { useLogout } from '@/service/use-common'
import { timezones } from '@/utils/timezone'
import AccountAbout from '../account-about'
import GithubStar from '../github-star'
import Indicator from '../indicator'
import Compliance from './compliance'
import { ExternalLinkIndicator, MenuItemContent } from './menu-item-content'
import Support from './support'

type AccountMenuRouteItemProps = {
  href: string
  iconClassName: string
  label: ReactNode
  trailing?: ReactNode
}

function AccountMenuRouteItem({
  href,
  iconClassName,
  label,
  trailing,
}: AccountMenuRouteItemProps) {
  return (
    <DropdownMenuLinkItem
      className="justify-between"
      render={<Link href={href} />}
    >
      <MenuItemContent iconClassName={iconClassName} label={label} trailing={trailing} />
    </DropdownMenuLinkItem>
  )
}

type AccountMenuExternalItemProps = {
  href: string
  iconClassName: string
  label: ReactNode
  trailing?: ReactNode
}

function AccountMenuExternalItem({
  href,
  iconClassName,
  label,
  trailing,
}: AccountMenuExternalItemProps) {
  return (
    <DropdownMenuLinkItem
      className="justify-between"
      href={href}
      rel="noopener noreferrer"
      target="_blank"
    >
      <MenuItemContent iconClassName={iconClassName} label={label} trailing={trailing} />
    </DropdownMenuLinkItem>
  )
}

type AccountMenuActionItemProps = {
  iconClassName: string
  label: ReactNode
  onClick?: MouseEventHandler<HTMLElement>
  trailing?: ReactNode
}

function AccountMenuActionItem({
  iconClassName,
  label,
  onClick,
  trailing,
}: AccountMenuActionItemProps) {
  return (
    <DropdownMenuItem
      className="justify-between"
      onClick={onClick}
    >
      <MenuItemContent iconClassName={iconClassName} label={label} trailing={trailing} />
    </DropdownMenuItem>
  )
}

type AccountMenuSectionProps = {
  children: ReactNode
}

function AccountMenuSection({ children }: AccountMenuSectionProps) {
  return <DropdownMenuGroup className="py-1">{children}</DropdownMenuGroup>
}

type AccountDropdownProps = {
  trigger?: (props: {
    isOpen: boolean
    ariaLabel: string
  }) => ReactElement
  mainNavBadge?: ReactNode
  variant?: 'default' | 'mainNav'
}

const mainNavMenuPopupClassName = 'w-60 max-w-80 overflow-hidden bg-components-panel-bg-blur! p-0! backdrop-blur-[5px]'
const mainNavMenuGroupClassName = 'p-1'
const mainNavMenuItemClassName = 'mx-0 h-8 gap-1 px-3 py-1'
const mainNavMenuSubPopupClassName = 'w-60 max-h-[360px] bg-components-panel-bg-blur! p-1! backdrop-blur-[5px]'

function MainNavRadioItemContent({
  iconClassName,
  label,
}: {
  iconClassName?: string
  label: ReactNode
}) {
  return (
    <>
      {iconClassName && <span aria-hidden className={cn('size-4 shrink-0 text-text-tertiary', iconClassName)} />}
      <span className="min-w-0 grow truncate px-1 system-md-regular text-text-secondary">{label}</span>
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

export default function AppSelector({
  mainNavBadge,
  trigger,
  variant = 'default',
}: AccountDropdownProps = {}) {
  const router = useRouter()
  const [aboutVisible, setAboutVisible] = useState(false)
  const [isAccountMenuOpen, setIsAccountMenuOpen] = useState(false)
  const { data: systemFeatures } = useSuspenseQuery(systemFeaturesQueryOptions())

  const { t } = useTranslation()
  const docLink = useDocLink()
  const { userProfile, langGeniusVersionInfo, isCurrentWorkspaceOwner } = useAppContext()
  const { isEducationAccount } = useProviderContext()
  const { setShowAccountSettingModal } = useModalContext()

  const { mutateAsync: logout } = useLogout()
  const handleLogout = async () => {
    await logout()
    resetUser()
    localStorage.removeItem('setup_status')
    // Tokens are now stored in cookies and cleared by backend

    // To avoid use other account's education notice info
    localStorage.removeItem('education-reverify-prev-expire-at')
    localStorage.removeItem('education-reverify-has-noticed')
    localStorage.removeItem('education-expired-has-noticed')

    router.push('/signin')
  }

  return (
    <div>
      <DropdownMenu open={isAccountMenuOpen} onOpenChange={setIsAccountMenuOpen}>
        {trigger
          ? (
              <DropdownMenuTrigger
                render={trigger({
                  isOpen: isAccountMenuOpen,
                  ariaLabel: t('account.account', { ns: 'common' }),
                })}
              />
            )
          : (
              <DropdownMenuTrigger
                aria-label={t('account.account', { ns: 'common' })}
                className={cn('inline-flex items-center rounded-[20px] p-0.5 hover:bg-background-default-dodge', isAccountMenuOpen && 'bg-background-default-dodge')}
              >
                <Avatar avatar={userProfile.avatar_url} name={userProfile.name} size="lg" />
              </DropdownMenuTrigger>
            )}
        <DropdownMenuContent
          placement={variant === 'mainNav' ? 'top-start' : 'bottom-end'}
          sideOffset={6}
          alignOffset={variant === 'mainNav' ? 4 : 0}
          popupClassName={variant === 'mainNav' ? mainNavMenuPopupClassName : 'w-60 max-w-80 bg-components-panel-bg-blur! py-0! backdrop-blur-xs'}
        >
          {variant === 'mainNav'
            ? (
                <>
                  <DropdownMenuGroup className={mainNavMenuGroupClassName}>
                    <div className="flex items-center gap-1 rounded-xl bg-gradient-to-b from-background-section-burn to-background-section p-3">
                      <div className="flex min-w-0 grow flex-col gap-1">
                        <div className="flex min-w-0 items-center gap-1">
                          <div className="truncate body-md-medium text-text-primary">{userProfile.name}</div>
                          {mainNavBadge}
                        </div>
                        <div className="truncate system-xs-regular text-text-tertiary">{userProfile.email}</div>
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
                        void handleLogout()
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
            : (
                <>
                  <DropdownMenuGroup className="py-1">
                    <div className="mx-1 flex flex-nowrap items-center py-2 pr-2 pl-3">
                      <div className="grow">
                        <div className="system-md-medium break-all text-text-primary">
                          {userProfile.name}
                          {isEducationAccount && (
                            <PremiumBadge size="s" color="blue" className="ml-1 px-2!">
                              <span aria-hidden className="mr-1 i-ri-graduation-cap-fill h-3 w-3" />
                              <span className="system-2xs-medium">EDU</span>
                            </PremiumBadge>
                          )}
                        </div>
                        <div className="system-xs-regular break-all text-text-tertiary">{userProfile.email}</div>
                      </div>
                      <Avatar avatar={userProfile.avatar_url} name={userProfile.name} size="lg" />
                    </div>
                    <AccountMenuRouteItem
                      href="/account"
                      iconClassName="i-ri-account-circle-line"
                      label={t('account.account', { ns: 'common' })}
                      trailing={<ExternalLinkIndicator />}
                    />
                    <AccountMenuActionItem
                      iconClassName="i-ri-settings-3-line"
                      label={t('userProfile.settings', { ns: 'common' })}
                      onClick={() => setShowAccountSettingModal({ payload: ACCOUNT_SETTING_TAB.MEMBERS })}
                    />
                  </DropdownMenuGroup>
                  <DropdownMenuSeparator className="my-0! bg-divider-subtle" />
                  {!systemFeatures.branding.enabled && (
                    <>
                      <AccountMenuSection>
                        <AccountMenuExternalItem
                          href={docLink('/use-dify/getting-started/introduction')}
                          iconClassName="i-ri-book-open-line"
                          label={t('userProfile.helpCenter', { ns: 'common' })}
                          trailing={<ExternalLinkIndicator />}
                        />
                        <Support closeAccountDropdown={() => setIsAccountMenuOpen(false)} />
                        {IS_CLOUD_EDITION && isCurrentWorkspaceOwner && <Compliance />}
                      </AccountMenuSection>
                      <DropdownMenuSeparator className="my-0! bg-divider-subtle" />
                      <AccountMenuSection>
                        <AccountMenuExternalItem
                          href="https://roadmap.dify.ai"
                          iconClassName="i-ri-map-2-line"
                          label={t('userProfile.roadmap', { ns: 'common' })}
                          trailing={<ExternalLinkIndicator />}
                        />
                        <AccountMenuExternalItem
                          href="https://github.com/langgenius/dify"
                          iconClassName="i-ri-github-line"
                          label={t('userProfile.github', { ns: 'common' })}
                          trailing={(
                            <div className="flex items-center gap-0.5 rounded-[5px] border border-divider-deep bg-components-badge-bg-dimm px-[5px] py-[3px]">
                              <span aria-hidden className="i-ri-star-line size-3 shrink-0 text-text-tertiary" />
                              <GithubStar className="system-2xs-medium-uppercase text-text-tertiary" />
                            </div>
                          )}
                        />
                        {
                          env.NEXT_PUBLIC_SITE_ABOUT !== 'hide' && (
                            <AccountMenuActionItem
                              iconClassName="i-ri-information-2-line"
                              label={t('userProfile.about', { ns: 'common' })}
                              onClick={() => {
                                setAboutVisible(true)
                                setIsAccountMenuOpen(false)
                              }}
                              trailing={(
                                <div className="flex shrink-0 items-center">
                                  <div className="mr-2 system-xs-regular text-text-tertiary">{langGeniusVersionInfo.current_version}</div>
                                  <Indicator color={langGeniusVersionInfo.current_version === langGeniusVersionInfo.latest_version ? 'green' : 'orange'} />
                                </div>
                              )}
                            />
                          )
                        }
                      </AccountMenuSection>
                      <DropdownMenuSeparator className="my-0! bg-divider-subtle" />
                    </>
                  )}
                  <AccountMenuSection>
                    <DropdownMenuItem
                      closeOnClick={false}
                      className="cursor-default data-highlighted:bg-transparent"
                    >
                      <MenuItemContent
                        iconClassName="i-ri-t-shirt-2-line"
                        label={t('theme.theme', { ns: 'common' })}
                        trailing={<ThemeSwitcher />}
                      />
                    </DropdownMenuItem>
                  </AccountMenuSection>
                  <DropdownMenuSeparator className="my-0! bg-divider-subtle" />
                  <AccountMenuSection>
                    <AccountMenuActionItem
                      iconClassName="i-ri-logout-box-r-line"
                      label={t('userProfile.logout', { ns: 'common' })}
                      onClick={() => {
                        void handleLogout()
                      }}
                    />
                  </AccountMenuSection>
                </>
              )}
        </DropdownMenuContent>
      </DropdownMenu>
      {
        aboutVisible && <AccountAbout onCancel={() => setAboutVisible(false)} langGeniusVersionInfo={langGeniusVersionInfo} />
      }
    </div>
  )
}
