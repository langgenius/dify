'use client'

import type { MarketplaceTemplate } from '@dify/contracts/marketplace'
import type { MarketplaceSearchSelection } from '../home/marketplace-search-autocomplete'
import type { CreatorCreation, LoadedCreatorProfile } from './model'
import type { Plugin } from '@/app/components/plugins/types'
import { useMemo, useState } from 'react'
import useCheckInstalled from '@/app/components/plugins/install-plugin/hooks/use-check-installed'
import { useRouter } from '@/next/navigation'
import MarketplaceDetailDialog from '../detail-dialog'
import TemplateDetailDialog from '../templates/template-detail-dialog'
import { getFormattedPlugin } from '../utils'
import CreatorProfileHeader from './header'
import CreatorProfileView from './view'

type SelectedCreation =
  | { kind: 'plugin'; plugin: Plugin }
  | { kind: 'template'; template: MarketplaceTemplate }

type DifyCreatorProfileProps = {
  loadedProfile: LoadedCreatorProfile
  locale: string
}

const normalizePlugin = (plugin: Plugin): Plugin => ({
  ...plugin,
  label: plugin.label ?? {},
  brief: plugin.brief ?? {},
  description: plugin.description ?? {},
  tags: plugin.tags ?? [],
  badges: plugin.badges ?? null,
})

export default function DifyCreatorProfile({ loadedProfile, locale }: DifyCreatorProfileProps) {
  const router = useRouter()
  const [selected, setSelected] = useState<SelectedCreation | null>(null)
  const profilePlugins = Object.values(loadedProfile.pluginsByCreationId)
  const pluginIds = useMemo(
    () =>
      Array.from(
        new Set([
          ...profilePlugins.map((plugin) => plugin.plugin_id),
          ...(selected?.kind === 'plugin' ? [selected.plugin.plugin_id] : []),
        ]),
      ).sort(),
    [profilePlugins, selected],
  )
  const { installedInfo } = useCheckInstalled({
    pluginIds,
    enabled: pluginIds.length > 0,
  })

  const selectCreation = (creation: CreatorCreation) => {
    if (creation.kind === 'plugin') {
      const plugin = loadedProfile.pluginsByCreationId[creation.id]
      if (plugin) setSelected({ kind: 'plugin', plugin: normalizePlugin(plugin) })
      return
    }

    const template = loadedProfile.templatesByCreationId[creation.id]
    if (template) setSelected({ kind: 'template', template })
  }

  const selectSearchResult = (selection: MarketplaceSearchSelection) => {
    if (selection.kind === 'plugin') {
      setSelected({
        kind: 'plugin',
        plugin: normalizePlugin(getFormattedPlugin(selection.plugin)),
      })
      return
    }
    setSelected({ kind: 'template', template: selection.template })
  }

  const closeSelected = () => setSelected(null)
  const selectedPlugin = selected?.kind === 'plugin' ? selected.plugin : null
  const selectedTemplate = selected?.kind === 'template' ? selected.template : null

  return (
    <>
      <CreatorProfileView
        profile={loadedProfile.viewModel}
        homeHref="/marketplace"
        isMarketplacePlatform
        getCreationAction={(creation) => ({
          type: 'select',
          onSelect: () => selectCreation(creation),
        })}
        header={<CreatorProfileHeader locale={locale} onSuggestionSelect={selectSearchResult} />}
      />

      {selectedPlugin && (
        <MarketplaceDetailDialog
          isInstalled={Boolean(installedInfo?.[selectedPlugin.plugin_id])}
          open
          plugin={selectedPlugin}
          onOpenChange={(open) => {
            if (!open) closeSelected()
          }}
        />
      )}
      {selectedTemplate && (
        <TemplateDetailDialog
          open
          template={selectedTemplate}
          onInstall={() => {
            closeSelected()
            router.push(`/apps?template-id=${encodeURIComponent(selectedTemplate.id)}`)
          }}
          onOpenChange={(open) => {
            if (!open) closeSelected()
          }}
        />
      )}
    </>
  )
}
