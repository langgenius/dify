import type { SearchParams } from 'nuqs'
import Marketplace from '@/app/components/plugins/marketplace'
import PluginPage from '@/app/components/plugins/plugin-page'
import PluginsPanel from '@/app/components/plugins/plugin-page/plugins-panel'

type PluginListProps = {
  searchParams: Promise<SearchParams>
}

const PluginList = ({ searchParams }: PluginListProps) => {
  return (
    <PluginPage
      plugins={<PluginsPanel />}
      marketplace={<Marketplace pluginTypeSwitchClassName="top-[60px]" searchParams={searchParams} />}
    />
  )
}

export default PluginList
