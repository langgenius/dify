'use client'

import type { MarketplacePlugin, MarketplaceTemplate } from '@dify/contracts/marketplace'
import { useAtomValue } from 'jotai'
import { useTheme } from 'next-themes'
import { useSyncExternalStore } from 'react'
import { useLocale } from '#i18n'
import { marketplaceLinks } from '@/features/marketplace/links'
import { deploymentEditionAtom } from '@/features/system-features/state'

const subscribe = () => () => {}
const getOrigin = () => window.location.origin
const getServerOrigin = () => ''

type PluginDetail = Pick<MarketplacePlugin, 'org' | 'name' | 'type'>
type TemplateDetail = Pick<
  MarketplaceTemplate,
  'id' | 'publisher_handle' | 'publisher_unique_handle'
>

// Only Dify entrypoints use this hook. Standalone Marketplace components must
// not depend on the Console's deployment state or query its system features.
export function useMarketplaceDetailNavigation() {
  const edition = useAtomValue(deploymentEditionAtom)
  const language = useLocale()
  const { resolvedTheme } = useTheme()
  const source = useSyncExternalStore(subscribe, getOrigin, getServerOrigin)
  const opensExternally = edition === 'COMMUNITY' || edition === 'ENTERPRISE'

  const detailParams = { language, theme: resolvedTheme }
  const pluginHref = (plugin: PluginDetail) =>
    opensExternally && plugin.type !== 'bundle'
      ? marketplaceLinks.officialPluginDetail(plugin, detailParams, source)
      : undefined
  const templateHref = (template: TemplateDetail) =>
    opensExternally
      ? marketplaceLinks.officialTemplateDetail(template, detailParams, source)
      : undefined

  // Search selections are commands, so open synchronously within the gesture.
  // Ordinary cards use the href directly to retain native link behavior.
  const open = (href: string | undefined) => {
    if (!href) return false
    window.open(href, '_blank', 'noopener,noreferrer')
    return true
  }

  return {
    source,
    opensExternally,
    pluginHref,
    templateHref,
    openPlugin: (plugin: PluginDetail) => open(pluginHref(plugin)),
    openTemplate: (template: TemplateDetail) => open(templateHref(template)),
  }
}
