import PluginPage from '@/app/components/plugins/plugin-page'
import PluginsPanel from '@/app/components/plugins/plugin-page/plugins-panel'
import Marketplace from '@/app/components/plugins/marketplace'
import { getLocaleOnServer } from '@/i18n/server'

const PluginList = async () => {
  const locale = await getLocaleOnServer()
  return (
    <PluginPage
      plugins={<PluginsPanel />}
      marketplace={<Marketplace locale={locale} pluginTypeSwitchClassName='top-[60px]' searchBoxAutoAnimate={false} />}
    />
  )
}

export default PluginList
