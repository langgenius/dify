import PluginsPanel from './plugins-panel'
import Container from './container'
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
