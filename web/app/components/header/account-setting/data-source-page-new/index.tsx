import { useSuspenseQuery } from '@tanstack/react-query'
import { memo } from 'react'
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
