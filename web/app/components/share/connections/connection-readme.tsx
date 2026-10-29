'use client'

import type { RequiredConnectionService } from './required-services'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogTitle,
  DialogTrigger,
} from '@langgenius/dify-ui/dialog'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import { skipToken, useQuery } from '@tanstack/react-query'
import { useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'
import { useLocale } from '#i18n'
import AppIcon from '@/app/components/base/app-icon'
import { ReadmePanelView } from '@/app/components/plugins/readme-panel/view'
import useTheme from '@/hooks/use-theme'
import { getModelLanguage } from '@/i18n/metadata'
import { webAppQuery } from '@/service/webapp'
import { resolveWebAppAddress } from '@/service/webapp-address'
import { getWebAppAuthSessionSnapshot, subscribeWebAppAuthSession } from '@/service/webapp-auth'
import { Theme } from '@/types/app'

function ConnectionReadmeContent({
  service,
  pluginUniqueIdentifier,
}: {
  service: RequiredConnectionService
  pluginUniqueIdentifier: string
}) {
  const { t } = useTranslation(['plugin', 'common'])
  const locale = useLocale()
  const { theme } = useTheme()
  const address = resolveWebAppAddress()
  const authSession = useSyncExternalStore(
    subscribeWebAppAuthSession,
    getWebAppAuthSessionSnapshot,
    () => 0,
  )
  const input = address
    ? {
        query: {
          plugin_unique_identifier: pluginUniqueIdentifier,
          language: getModelLanguage(locale),
        },
      }
    : skipToken
  const query = useQuery(
    webAppQuery.connections.readme.get.queryOptions({
      input,
      queryKey: [...webAppQuery.connections.readme.get.queryKey({ input }), address, authSession],
      context: { address: address ?? undefined, authSession, silent: true },
      retry: false,
      refetchOnWindowFocus: false,
    }),
  )

  return (
    <ReadmePanelView
      title={
        <DialogTitle
          // oxlint-disable-next-line shadcn/no-restyle -- Match the shared README panel's section label.
          className="truncate text-xs font-medium text-text-tertiary uppercase"
        >
          {t(($) => $['readmeInfo.title'], { ns: 'plugin' })}
        </DialogTitle>
      }
      closeButton={
        <DialogClose
          render={
            <IconButton aria-label={t(($) => $['operation.close'], { ns: 'common' })} size="lg">
              <span aria-hidden="true" className="i-ri-close-line size-4" />
            </IconButton>
          }
        />
      }
      header={
        <div className="flex items-center gap-3">
          <AppIcon
            size="large"
            icon={theme === Theme.dark && service.iconDark ? service.iconDark : service.icon}
            decorative
          />
          <span className="system-lg-semibold min-w-0 wrap-anywhere text-text-primary">
            {service.name}
          </span>
        </div>
      }
      readme={query.data?.readme}
      isLoading={query.isPending}
      error={query.error}
    />
  )
}

export default function ConnectionReadme({ service }: { service: RequiredConnectionService }) {
  const { t } = useTranslation(['plugin'])
  if (!service.pluginUniqueIdentifier) return null

  return (
    <Dialog>
      <DialogTrigger className="inline-flex items-center gap-2 rounded-sm system-md-regular text-text-tertiary hover:text-text-accent focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden">
        <span aria-hidden="true" className="i-ri-book-open-line size-4 shrink-0" />
        {t(($) => $['readmeInfo.needHelpCheckReadme'], { ns: 'plugin' })}
      </DialogTrigger>
      <DialogContent
        className="h-[calc(100dvh-16px)] w-200 overflow-hidden"
        backdropProps={{ forceRender: true }}
      >
        <ConnectionReadmeContent
          service={service}
          pluginUniqueIdentifier={service.pluginUniqueIdentifier}
        />
      </DialogContent>
    </Dialog>
  )
}
