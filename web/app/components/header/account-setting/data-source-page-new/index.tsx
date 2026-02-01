import { memo } from 'react'
import { useSystemFeatures } from '@/hooks/use-global-public'
import { useGetDataSourceListAuth } from '@/service/use-datasource'
import Card from './card'
import InstallFromMarketplace from './install-from-marketplace'

const DataSourcePage = () => {
  const { enable_marketplace } = useSystemFeatures()
  const { data } = useGetDataSourceListAuth()

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
          <InstallFromMarketplace
            providers={data?.result || []}
            searchText=""
          />
        )
      }
    </div>
  )
}

export default memo(DataSourcePage)
