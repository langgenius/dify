import PluginPage from '@/app/components/plugins/plugin-page'
import PluginsPanel from '@/app/components/plugins/plugin-page/plugins-panel'
import Marketplace from '@/app/components/plugins/marketplace'
import { getLocaleOnServer } from '@/i18n/server'
import type { SearchParams } from '@/app/components/plugins/marketplace/types'

const PluginList = async (
  props: {
    searchParams: Promise<SearchParams>
  },
) => {
  const searchParams = await props.searchParams
  const locale = await getLocaleOnServer()
  return (
    <PluginPage
      plugins={<PluginsPanel />}
      marketplace={<Marketplace searchParams={searchParams} locale={locale} pluginTypeSwitchClassName='top-[60px]' searchBoxAutoAnimate={false} />}
    />
  )
}

export default PluginList
