'use client'

import type { Plugin } from '@/app/components/plugins/types'
import { useTheme } from 'next-themes'
import { useCallback } from 'react'
import { useLocale, useTranslation } from '#i18n'
import { getPluginLinkInMarketplace } from '../utils'
import MarketplaceDetailDialogFrame from './frame'

const MARKETPLACE_INSTALL_MESSAGE_TYPE = 'dify-marketplace:install-plugin'

type MarketplaceDetailDialogProps = {
  isInstalled: boolean
  open: boolean
  plugin: Plugin
  onInstall: () => void
  onOpenChange: (open: boolean) => void
}

function MarketplaceDetailDialog({
  isInstalled,
  open,
  plugin,
  onInstall,
  onOpenChange,
}: MarketplaceDetailDialogProps) {
  const { t } = useTranslation()
  const locale = useLocale()
  // resolvedTheme maps the "system" preference to the concrete light/dark
  // value the marketplace page expects.
  const { resolvedTheme } = useTheme()
  const pluginLabel = plugin.label[locale] ?? plugin.label['en-US'] ?? plugin.name
  const detailLabel = t(($) => $['detailPanel.operation.detail'], { ns: 'plugin' })
  const detailURL = getPluginLinkInMarketplace(plugin, {
    installed: String(isInstalled),
    language: locale,
    source: globalThis.location?.origin,
    theme: resolvedTheme,
    view: 'modal',
  })

  const handleMessage = useCallback(
    (data: unknown) => {
      if (
        typeof data !== 'object' ||
        data === null ||
        !('type' in data) ||
        !('pluginUniqueIdentifier' in data) ||
        data.type !== MARKETPLACE_INSTALL_MESSAGE_TYPE ||
        data.pluginUniqueIdentifier !== plugin.latest_package_identifier
      )
        return

      onInstall()
    },
    [onInstall, plugin.latest_package_identifier],
  )

  return (
    <MarketplaceDetailDialogFrame
      open={open}
      src={detailURL}
      title={`${pluginLabel} · ${detailLabel}`}
      onMessage={isInstalled ? undefined : handleMessage}
      onOpenChange={onOpenChange}
    />
  )
}

export default MarketplaceDetailDialog
