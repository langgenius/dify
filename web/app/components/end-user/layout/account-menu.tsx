'use client'

import { Avatar, AvatarFallback, AvatarImage } from '@langgenius/dify-ui/avatar'
import { Menu, MenuContent, MenuGroup, MenuItem, MenuTrigger } from '@langgenius/dify-ui/menu'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'
import LogoutMenuItem from '@/app/components/header/account-menu/logout-menu-item'
import { webAppQuery } from '@/service/webapp'
import {
  getWebAppAuthSessionSnapshot,
  subscribeWebAppAuthSession,
  webAppLogout,
} from '@/service/webapp-auth'
import { getAvatarInitial } from '@/utils/avatar'
import { basePath } from '@/utils/var'

export default function AccountMenu() {
  const { t } = useTranslation(['app', 'common'])
  const authSession = useSyncExternalStore(
    subscribeWebAppAuthSession,
    getWebAppAuthSessionSnapshot,
    () => 0,
  )
  const profile = useQuery(
    webAppQuery.account.profile.get.queryOptions({
      queryKey: [...webAppQuery.account.profile.get.queryKey(), authSession],
      context: { authSession, silent: true },
      retry: false,
      gcTime: 0,
    }),
  )
  const account = profile.isError ? undefined : profile.data
  const name = account?.name || t(($) => $['endUser.account'], { ns: 'app' })
  const logout = useMutation({
    mutationFn: () => webAppLogout(null, { silent: true }),
    onSuccess: () => window.location.replace(`${basePath}/my-apps`),
  })

  return (
    <Menu>
      <MenuTrigger
        aria-label={
          account?.name
            ? t(($) => $['endUser.userMenu'], { ns: 'app', name: account.name })
            : t(($) => $['endUser.account'], { ns: 'app' })
        }
        className="flex h-10 min-w-0 flex-1 items-center gap-2 rounded-lg px-2 text-text-secondary hover:bg-state-base-hover data-popup-open:bg-state-base-hover"
      >
        <Avatar size="sm" aria-hidden>
          <AvatarFallback>
            {account?.name ? (
              getAvatarInitial(account.name)
            ) : (
              <span className="i-ri-user-line size-4" />
            )}
          </AvatarFallback>
          {account?.avatar_url && <AvatarImage src={account.avatar_url} alt="" />}
        </Avatar>
        <span className="min-w-0 grow text-start system-sm-medium wrap-anywhere">{name}</span>
      </MenuTrigger>
      <MenuContent
        side="top"
        align="start"
        sideOffset={6}
        alignOffset={4}
        className="w-60 max-w-80 overflow-hidden p-0"
      >
        {profile.isError && (
          <MenuGroup className="py-1">
            <p
              role="alert"
              className="px-3 py-1 system-xs-regular wrap-anywhere text-text-destructive"
            >
              {profile.error.message || t(($) => $['api.actionFailed'], { ns: 'common' })}
            </p>
            <MenuItem
              closeOnClick={false}
              disabled={profile.isFetching}
              onClick={() => profile.refetch()}
            >
              {t(($) => $['operation.retry'], { ns: 'common' })}
            </MenuItem>
          </MenuGroup>
        )}
        <MenuGroup className="py-1">
          {logout.isError && (
            <p
              role="alert"
              className="px-3 py-1 system-xs-regular wrap-anywhere text-text-destructive"
            >
              {logout.error.message || t(($) => $['api.actionFailed'], { ns: 'common' })}
            </p>
          )}
          <LogoutMenuItem
            onLogout={() => logout.mutate()}
            disabled={logout.isPending}
            closeOnClick={false}
          />
        </MenuGroup>
      </MenuContent>
    </Menu>
  )
}
