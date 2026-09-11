'use client'

import type { Plugin } from '@/app/components/plugins/types'
import { useTheme } from 'next-themes'
import { useCallback, useEffect, useRef } from 'react'
import { useLocale, useTranslation } from '#i18n'
import { useOptionalPluginInstallPermission } from '@/app/components/plugins/install-plugin/hooks/use-plugin-install-permission'
import { getPluginLinkInMarketplace } from '../utils'
import MarketplaceDetailDialogFrame from './frame'
import { useSilentMarketplaceInstall } from './use-silent-install'

const MARKETPLACE_INSTALL_MESSAGE_TYPE = 'dify-marketplace:install-plugin'
const MARKETPLACE_INSTALL_STATUS_MESSAGE_TYPE = 'dify-marketplace:install-plugin-status'
const SILENT_INSTALL_TIMEOUT_MS = 5 * 60 * 1000

type MarketplaceDetailDialogProps = {
  isInstalled: boolean
  open: boolean
  plugin: Plugin
  onOpenChange: (open: boolean) => void
}

const isInstallRequest = (data: unknown, pluginUniqueIdentifier: string) => {
  return (
    typeof data === 'object' &&
    data !== null &&
    'type' in data &&
    'pluginUniqueIdentifier' in data &&
    data.type === MARKETPLACE_INSTALL_MESSAGE_TYPE &&
    data.pluginUniqueIdentifier === pluginUniqueIdentifier
  )
}

function OpenMarketplaceDetailDialog({
  canInstallPlugin,
  onOpenChange,
  plugin,
  src,
  title,
}: {
  canInstallPlugin: boolean
  onOpenChange: (open: boolean) => void
  plugin: Plugin
  src: string
  title: string
}) {
  const { install } = useSilentMarketplaceInstall()
  const timeoutIdsRef = useRef(new Set<number>())

  useEffect(
    () => () => {
      timeoutIdsRef.current.forEach((id) => window.clearTimeout(id))
      timeoutIdsRef.current.clear()
    },
    [],
  )

  const handleMessage = useCallback(
    (data: unknown, reply: (payload: unknown) => void) => {
      if (!isInstallRequest(data, plugin.latest_package_identifier)) return

      const uniqueIdentifier = plugin.latest_package_identifier
      if (!canInstallPlugin) {
        reply({
          type: MARKETPLACE_INSTALL_STATUS_MESSAGE_TYPE,
          pluginUniqueIdentifier: uniqueIdentifier,
          status: 'failed',
        })
        return
      }

      let settled = false
      const settle = (payload: Record<string, unknown>) => {
        if (settled) return
        settled = true
        reply(payload)
      }

      const timeoutId = window.setTimeout(() => {
        timeoutIdsRef.current.delete(timeoutId)
        settle({
          type: MARKETPLACE_INSTALL_STATUS_MESSAGE_TYPE,
          pluginUniqueIdentifier: uniqueIdentifier,
          status: 'timeout',
        })
      }, SILENT_INSTALL_TIMEOUT_MS)
      timeoutIdsRef.current.add(timeoutId)

      void install(plugin).then((result) => {
        window.clearTimeout(timeoutId)
        timeoutIdsRef.current.delete(timeoutId)
        settle({
          type: MARKETPLACE_INSTALL_STATUS_MESSAGE_TYPE,
          pluginUniqueIdentifier: uniqueIdentifier,
          ...result,
        })
      })
    },
    [canInstallPlugin, install, plugin],
  )

  return (
    <MarketplaceDetailDialogFrame
      open
      src={src}
      title={title}
      onMessage={handleMessage}
      onOpenChange={onOpenChange}
    />
  )
}

function MarketplaceDetailDialog({
  isInstalled,
  open,
  plugin,
  onOpenChange,
}: MarketplaceDetailDialogProps) {
  const { t } = useTranslation()
  const locale = useLocale()
  const { canInstallPlugin } = useOptionalPluginInstallPermission()
  // resolvedTheme maps the "system" preference to the concrete light/dark
  // value the marketplace page expects.
  const { resolvedTheme } = useTheme()
  const pluginLabel = plugin.label[locale] ?? plugin.label['en-US'] ?? plugin.name
  const detailLabel = t(($) => $['detailPanel.operation.detail'], { ns: 'plugin' })
  const installedForSrcRef = useRef(isInstalled)
  if (!open) installedForSrcRef.current = isInstalled
  const detailURL = getPluginLinkInMarketplace(plugin, {
    canInstall: String(canInstallPlugin),
    installed: String(installedForSrcRef.current),
    language: locale,
    source: globalThis.location?.origin,
    theme: resolvedTheme,
    view: 'modal',
  })
  const title = `${pluginLabel} · ${detailLabel}`

  if (!open) {
    return (
      <MarketplaceDetailDialogFrame
        open={false}
        src={detailURL}
        title={title}
        onOpenChange={onOpenChange}
      />
    )
  }

  return (
    <OpenMarketplaceDetailDialog
      canInstallPlugin={canInstallPlugin}
      plugin={plugin}
      src={detailURL}
      title={title}
      onOpenChange={onOpenChange}
    />
  )
}

export default MarketplaceDetailDialog
