import { useSuspenseQuery } from '@tanstack/react-query'
import { memo } from 'react'
import { PluginInstallPermissionProvider } from '@/app/components/plugins/install-plugin/components/plugin-install-permission-provider'
import useWorkspacePluginInstallPermission from '@/app/components/plugins/install-plugin/hooks/use-workspace-plugin-install-permission'
import { systemFeaturesQueryOptions } from '@/service/system-features'
import { useGetDataSourceListAuth } from '@/service/use-datasource'
import Card from './card'
import InstallFromMarketplace from './install-from-marketplace'

const DataSourcePage = () => {
  const { data: enable_marketplace } = useSuspenseQuery({
    ...systemFeaturesQueryOptions(),
    select: s => s.enable_marketplace,
  })
  const { data } = useGetDataSourceListAuth()
  const { canInstallPlugin, currentDifyVersion } = useWorkspacePluginInstallPermission()

  return (
    <div>
      <div className="space-y-2">
        {
          data?.result.map(item => (
            <Card
              key={item.plugin_unique_identifier}
              item={item}
            />
          ))
        }
      </div>
      {
        enable_marketplace && (
          <PluginInstallPermissionProvider
            canInstallPlugin={canInstallPlugin}
            currentDifyVersion={currentDifyVersion}
          >
            <InstallFromMarketplace
              providers={data?.result || []}
              searchText=""
            />
          </PluginInstallPermissionProvider>
        )
      }
    </div>
  )
}

export default memo(DataSourcePage)
