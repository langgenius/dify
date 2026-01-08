import type { SearchParams } from 'nuqs'
import { createLoader, parseAsArrayOf, parseAsString } from 'nuqs/server'
import Marketplace from '@/app/components/plugins/marketplace'
import PluginPage from '@/app/components/plugins/plugin-page'
import PluginsPanel from '@/app/components/plugins/plugin-page/plugins-panel'

const marketplaceSearchParams = {
  q: parseAsString.withDefault(''),
  category: parseAsString.withDefault('all'),
  tags: parseAsArrayOf(parseAsString).withDefault([]),
}

const loadSearchParams = createLoader(marketplaceSearchParams)

const PluginList = async ({ searchParams}: { searchParams: Promise<SearchParams> }) => {
  const params = await loadSearchParams(searchParams)
  return (
    <PluginPage
      plugins={<PluginsPanel />}
      marketplace={<Marketplace params={params} pluginTypeSwitchClassName="top-[60px]" />}
    />
  )
}

export default PluginList
