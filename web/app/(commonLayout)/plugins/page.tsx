import type { LegacyPluginsSearchParams } from '@/app/components/plugins/plugin-routes'
import Marketplace from '@/app/components/plugins/marketplace'
import PluginPage from '@/app/components/plugins/plugin-page'
import PluginsPanel from '@/app/components/plugins/plugin-page/plugins-panel'
import { getLegacyPluginRedirectPath } from '@/app/components/plugins/plugin-routes'
import { redirect } from '@/next/navigation'

type PluginListProps = {
  searchParams?: Promise<LegacyPluginsSearchParams>
}

const PluginList = async ({
  searchParams,
}: PluginListProps) => {
  const redirectPath = getLegacyPluginRedirectPath(await searchParams)

  if (redirectPath)
    redirect(redirectPath)

  return (
    <PluginPage
      plugins={<PluginsPanel />}
      marketplace={<Marketplace pluginTypeSwitchClassName="top-[60px]" />}
    />
  )
}

export default PluginList
