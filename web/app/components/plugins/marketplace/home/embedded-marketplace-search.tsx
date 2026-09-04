'use client'

import type { MarketplaceTemplate } from '@dify/contracts/marketplace'
import type { MarketplaceSearchSelection } from './marketplace-search-autocomplete'
import type { Plugin } from '@/app/components/plugins/types'
import { useCallback, useState } from 'react'
import { useLocale, useTranslation } from '#i18n'
import useCheckInstalled from '@/app/components/plugins/install-plugin/hooks/use-check-installed'
import { useRouter } from '@/next/navigation'
import { useSearchPluginText } from '../atoms'
import MarketplaceDetailDialog from '../detail-dialog'
import TemplateDetailDialog from '../templates/template-detail-dialog'
import { getFormattedPlugin } from '../utils'
import { MarketplaceSearchAutocomplete } from './marketplace-search-autocomplete'

const normalizePlugin = (plugin: Plugin): Plugin => ({
  ...plugin,
  plugin_id: plugin.plugin_id || `${plugin.org}/${plugin.name}`,
  label: plugin.label ?? {},
  brief: plugin.brief ?? {},
  description: plugin.description ?? {},
  tags: plugin.tags ?? [],
  badges: plugin.badges ?? null,
})

export default function EmbeddedMarketplaceSearch() {
  const { t } = useTranslation()
  const locale = useLocale()
  const router = useRouter()
  const [query, setQuery] = useSearchPluginText()
  const [value, setValue] = useState(query ?? '')
  const [valueQuery, setValueQuery] = useState(query)
  if (query !== valueQuery) {
    setValueQuery(query)
    setValue(query ?? '')
  }
  const [selectedPlugin, setSelectedPlugin] = useState<Plugin | null>(null)
  const [selectedTemplate, setSelectedTemplate] = useState<MarketplaceTemplate | null>(null)
  const { installedInfo } = useCheckInstalled({
    pluginIds: selectedPlugin ? [selectedPlugin.plugin_id] : [],
    enabled: Boolean(selectedPlugin),
  })

  const handleSuggestionSelect = useCallback((selection: MarketplaceSearchSelection) => {
    if (selection.kind === 'plugin') {
      setSelectedTemplate(null)
      setSelectedPlugin(normalizePlugin(getFormattedPlugin(selection.plugin)))
      return
    }

    setSelectedPlugin(null)
    setSelectedTemplate(selection.template)
  }, [])

  return (
    <>
      <form
        className="relative w-full shrink-0"
        onSubmit={(event) => {
          event.preventDefault()
          void setQuery(value.trim() || null)
        }}
      >
        <MarketplaceSearchAutocomplete
          key={query ?? ''}
          inputName="q"
          locale={locale}
          onSuggestionSelect={handleSuggestionSelect}
          onValueChange={setValue}
          placeholder={t(($) => $['marketplace.home.searchPlaceholder'], { ns: 'plugin' })}
          scope="all"
          value={value}
        />
      </form>
      {selectedPlugin && (
        <MarketplaceDetailDialog
          isInstalled={Boolean(installedInfo?.[selectedPlugin.plugin_id])}
          open
          plugin={selectedPlugin}
          onOpenChange={(open) => {
            if (!open) setSelectedPlugin(null)
          }}
        />
      )}
      {selectedTemplate && (
        <TemplateDetailDialog
          open
          template={selectedTemplate}
          onInstall={() => {
            const templateId = selectedTemplate.id
            setSelectedTemplate(null)
            router.push(`/apps?template-id=${encodeURIComponent(templateId)}`)
          }}
          onOpenChange={(open) => {
            if (!open) setSelectedTemplate(null)
          }}
        />
      )}
    </>
  )
}
