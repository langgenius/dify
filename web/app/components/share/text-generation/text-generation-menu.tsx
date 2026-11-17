'use client'
import type { MenuContentProps } from '@langgenius/dify-ui/menu'
import type { ThemePreference } from '@/features/theme/theme'
import type { SiteInfo } from '@/models/share'
import { Avatar, AvatarFallback, AvatarImage } from '@langgenius/dify-ui/avatar'
import { Button } from '@langgenius/dify-ui/button'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import {
  Menu,
  MenuContent,
  MenuGroupLabel,
  MenuItem,
  MenuLinkItem,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuTrigger,
} from '@langgenius/dify-ui/menu'
import { useQuery } from '@tanstack/react-query'
import * as React from 'react'
import { useState, useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'
import { useWebAppStore } from '@/context/web-app-context'
import { useThemePreference } from '@/features/theme/hooks'
import { themeOptions } from '@/features/theme/theme'
import { AccessMode } from '@/models/access-control'
import { usePathname, useRouter } from '@/next/navigation'
import { webAppQuery } from '@/service/webapp'
import { resolveWebAppAddress } from '@/service/webapp-address'
import {
  getWebAppAuthSessionSnapshot,
  subscribeWebAppAuthSession,
  webAppLogout,
} from '@/service/webapp-auth'
import { getAvatarInitial } from '@/utils/avatar'
import { useWebAppEntry } from '../webapp-entry'
import InfoModal from './info-modal'

type Props = Readonly<
  Pick<MenuContentProps, 'side' | 'align'> & {
    data?: SiteInfo
    hideLogout?: boolean
  }
>

function TextGenerationMenu({ data, side, align, hideLogout }: Props) {
  const webAppAccessMode = useWebAppStore((s) => s.webAppAccessMode)
  const entry = useWebAppEntry()
  const accountAuthenticated = entry && 'account' in entry && entry.account === 'authenticated'
  const authSession = useSyncExternalStore(
    subscribeWebAppAuthSession,
    getWebAppAuthSessionSnapshot,
    () => 0,
  )
  const profile = useQuery(
    webAppQuery.account.profile.get.queryOptions({
      queryKey: [...webAppQuery.account.profile.get.queryKey(), authSession],
      context: { authSession, silent: true },
      enabled: Boolean(accountAuthenticated),
      staleTime: 0,
      gcTime: 0,
      retry: false,
    }),
  )
  const router = useRouter()
  const pathname = usePathname()
  const { t } = useTranslation(['common', 'share'])
  const accountProfile = profile.isError ? undefined : profile.data
  const accountName = accountProfile?.name || t(($) => $['operation.more'], { ns: 'common' })

  const handleLogout = async () => {
    const address = resolveWebAppAddress()
    await webAppLogout(address)
    if (accountAuthenticated && address?.kind === 'default') window.location.reload()
    else router.replace(`/webapp-signin?redirect_url=${pathname}`)
  }

  const { preference, setPreference } = useThemePreference()
  const [show, setShow] = useState(false)
  const handleOpenInfoModal = () => {
    queueMicrotask(() => {
      setShow(true)
    })
  }

  return (
    <>
      <Menu>
        <MenuTrigger
          render={
            accountAuthenticated ? (
              <Button
                variant="ghost"
                className="h-auto max-w-full min-w-0 gap-0 rounded-full p-0.5 data-popup-open:bg-state-base-hover"
              >
                <Avatar size="sm" className="rounded-full" aria-hidden="true">
                  <AvatarImage keepMounted src={accountProfile?.avatar_url ?? undefined} alt="" />
                  <AvatarFallback>{getAvatarInitial(accountProfile?.name)}</AvatarFallback>
                </Avatar>
                <span className="min-w-0 truncate px-2 system-sm-medium text-text-secondary">
                  {accountName}
                </span>
              </Button>
            ) : (
              <IconButton
                aria-label={t(($) => $['operation.more'], { ns: 'common' })}
                size="lg"
                className="data-popup-open:bg-state-base-hover"
              >
                <span aria-hidden className="i-ri-equalizer-2-line h-4.5 w-4.5" />
              </IconButton>
            )
          }
        />
        <MenuContent side={side} align={align} className="w-56">
          {accountAuthenticated && profile.isError && (
            <>
              <p role="alert" className="px-3 py-2 system-sm-regular text-text-secondary">
                {profile.error.message || t(($) => $['api.actionFailed'], { ns: 'common' })}
              </p>
              <MenuItem
                closeOnClick={false}
                disabled={profile.isFetching}
                onClick={() => {
                  void profile.refetch()
                }}
              >
                {t(($) => $['operation.retry'], { ns: 'common' })}
              </MenuItem>
              <MenuSeparator />
            </>
          )}
          <MenuRadioGroup<ThemePreference>
            value={preference}
            onValueChange={setPreference}
            className="flex items-center gap-2 px-3 system-md-regular text-text-secondary"
          >
            <MenuGroupLabel className="grow px-0 py-0 system-md-regular text-text-secondary normal-case">
              {t(($) => $['theme.label'], { ns: 'common' })}
            </MenuGroupLabel>
            <div className="flex items-center rounded-[10px] bg-components-segmented-control-bg-normal p-0.5">
              {themeOptions.map((option, index) => (
                <React.Fragment key={option.value}>
                  {index > 0 && (
                    <div
                      aria-hidden
                      className={
                        preference !== option.value && preference !== themeOptions[index - 1]?.value
                          ? 'h-3.5 w-px bg-divider-regular'
                          : 'h-3.5 w-px bg-transparent'
                      }
                    />
                  )}
                  <MenuRadioItem<ThemePreference>
                    value={option.value}
                    aria-label={t(($) => $[option.labelKey], { ns: 'common' })}
                    className="mx-0 h-auto py-1 text-text-tertiary data-checked:bg-components-segmented-control-item-active-bg data-checked:text-text-accent-light-mode-only data-checked:shadow-sm data-highlighted:text-text-secondary data-checked:data-highlighted:bg-components-segmented-control-item-active-bg data-checked:data-highlighted:text-text-accent-light-mode-only"
                  >
                    <span aria-hidden className="p-0.5">
                      <span className={`${option.iconClassName} size-4`} />
                    </span>
                  </MenuRadioItem>
                </React.Fragment>
              ))}
            </div>
          </MenuRadioGroup>
          <MenuSeparator />
          {data?.privacy_policy && (
            <MenuLinkItem
              className="system-md-regular"
              href={data.privacy_policy}
              target="_blank"
              rel="noreferrer"
            >
              <span className="grow">
                {t(($) => $['chat.privacyPolicyMiddle'], { ns: 'share' })}
              </span>
            </MenuLinkItem>
          )}
          <MenuItem className="system-md-regular" onClick={handleOpenInfoModal}>
            {t(($) => $['userProfile.about'], { ns: 'common' })}
          </MenuItem>
          {!hideLogout &&
            (accountAuthenticated ||
              (webAppAccessMode !== AccessMode.EXTERNAL_MEMBERS &&
                webAppAccessMode !== AccessMode.PUBLIC)) && (
              <MenuItem className="system-md-regular" onClick={handleLogout}>
                {t(($) => $['userProfile.logout'], { ns: 'common' })}
              </MenuItem>
            )}
        </MenuContent>
      </Menu>
      {show && (
        <InfoModal
          isShow={show}
          onClose={() => {
            setShow(false)
          }}
          data={data}
        />
      )}
    </>
  )
}
export default React.memo(TextGenerationMenu)
