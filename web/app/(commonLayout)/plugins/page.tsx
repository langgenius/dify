import PluginsPanel from '@/app/components/plugins/plugins-panel'
import Container from '@/app/components/plugins/container'
import Marketplace from '@/app/components/plugins/marketplace'

const PluginList = async () => {
  return (
    <Container
      plugins={<PluginsPanel />}
      marketplace={<Marketplace />}
    />
  )
}

export const metadata = {
  title: 'Plugins - Dify',
}

export default PluginList
