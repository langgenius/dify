'use client'

import type { MouseEventHandler, ReactNode } from 'react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { resetUser } from '@/app/components/base/amplitude/utils'
import { Avatar } from '@/app/components/base/avatar'
import PremiumBadge from '@/app/components/base/premium-badge'
import ThemeSwitcher from '@/app/components/base/theme-switcher'
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLinkItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/app/components/base/ui/dropdown-menu'
import { ACCOUNT_SETTING_TAB } from '@/app/components/header/account-setting/constants'
import { IS_CLOUD_EDITION } from '@/config'
import { useAppContext } from '@/context/app-context'
import { useGlobalPublicStore } from '@/context/global-public-context'
import { useDocLink } from '@/context/i18n'
import { useModalContext } from '@/context/modal-context'
import { useProviderContext } from '@/context/provider-context'
import { env } from '@/env'
import Link from '@/next/link'
import { useRouter } from '@/next/navigation'
import { useLogout } from '@/service/use-common'
import { cn } from '@/utils/classnames'
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

export default function AppSelector() {
  const router = useRouter()
  const [aboutVisible, setAboutVisible] = useState(false)
  const [isAccountMenuOpen, setIsAccountMenuOpen] = useState(false)
  const { systemFeatures } = useGlobalPublicStore()

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
        <DropdownMenuTrigger
          aria-label={t('account.account', { ns: 'common' })}
          className={cn('inline-flex items-center rounded-[20px] p-0.5 hover:bg-background-default-dodge', isAccountMenuOpen && 'bg-background-default-dodge')}
        >
          <Avatar avatar={userProfile.avatar_url} name={userProfile.name} size="lg" />
        </DropdownMenuTrigger>
        <DropdownMenuContent
          sideOffset={6}
          popupClassName="w-60 max-w-80 !bg-components-panel-bg-blur !py-0 backdrop-blur-sm"
        >
          <DropdownMenuGroup className="py-1">
            <div className="mx-1 flex flex-nowrap items-center py-2 pl-3 pr-2">
              <div className="grow">
                <div className="break-all text-text-primary system-md-medium">
                  {userProfile.name}
                  {isEducationAccount && (
                    <PremiumBadge size="s" color="blue" className="ml-1 !px-2">
                      <span aria-hidden className="i-ri-graduation-cap-fill mr-1 h-3 w-3" />
                      <span className="system-2xs-medium">EDU</span>
                    </PremiumBadge>
                  )}
                </div>
                <div className="break-all text-text-tertiary system-xs-regular">{userProfile.email}</div>
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
          <DropdownMenuSeparator className="!my-0 bg-divider-subtle" />
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
              <DropdownMenuSeparator className="!my-0 bg-divider-subtle" />
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
                      <GithubStar className="text-text-tertiary system-2xs-medium-uppercase" />
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
                          <div className="mr-2 text-text-tertiary system-xs-regular">{langGeniusVersionInfo.current_version}</div>
                          <Indicator color={langGeniusVersionInfo.current_version === langGeniusVersionInfo.latest_version ? 'green' : 'orange'} />
                        </div>
                      )}
                    />
                  )
                }
              </AccountMenuSection>
              <DropdownMenuSeparator className="!my-0 bg-divider-subtle" />
            </>
          )}
          <AccountMenuSection>
            <DropdownMenuItem
              closeOnClick={false}
              className="cursor-default data-[highlighted]:bg-transparent"
            >
              <MenuItemContent
                iconClassName="i-ri-t-shirt-2-line"
                label={t('theme.theme', { ns: 'common' })}
                trailing={<ThemeSwitcher />}
              />
            </DropdownMenuItem>
          </AccountMenuSection>
          <DropdownMenuSeparator className="!my-0 bg-divider-subtle" />
          <AccountMenuSection>
            <AccountMenuActionItem
              iconClassName="i-ri-logout-box-r-line"
              label={t('userProfile.logout', { ns: 'common' })}
              onClick={() => {
                void handleLogout()
              }}
            />
          </AccountMenuSection>
        </DropdownMenuContent>
      </DropdownMenu>
      {
        aboutVisible && <AccountAbout onCancel={() => setAboutVisible(false)} langGeniusVersionInfo={langGeniusVersionInfo} />
      }
    </div>
  )
}
