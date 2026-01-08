import type { SearchParams } from 'nuqs'
import Marketplace from '@/app/components/plugins/marketplace'
import PluginPage from '@/app/components/plugins/plugin-page'
import PluginsPanel from '@/app/components/plugins/plugin-page/plugins-panel'

const PluginList = async ({ searchParams}: { searchParams: Promise<SearchParams> }) => {
  return (
    <PluginPage
      plugins={<PluginsPanel />}
      marketplace={<Marketplace searchParams={searchParams} pluginTypeSwitchClassName="top-[60px]" />}
    />
  )
}

export default PluginList
