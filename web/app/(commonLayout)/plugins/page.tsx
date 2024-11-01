import PluginPage from '@/app/components/plugins/plugin-page'
import PluginsPanel from '@/app/components/plugins/plugin-page/plugins-panel'
import Marketplace from '@/app/components/plugins/marketplace'

const PluginList = async () => {
  return (
    <PluginPage
      plugins={<PluginsPanel />}
      marketplace={<Marketplace />}
    />
  )
}

export const metadata = {
  title: 'Plugins - Dify',
}

export default PluginList
