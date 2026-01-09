import Marketplace from '@/app/components/plugins/marketplace'
import PluginPage from '@/app/components/plugins/plugin-page'
import PluginsPanel from '@/app/components/plugins/plugin-page/plugins-panel'

const PluginList = () => {
  return (
    <PluginPage
      plugins={<PluginsPanel />}
      marketplace={<Marketplace pluginTypeSwitchClassName="top-[60px]" />}
    />
  )
}

export default PluginList
