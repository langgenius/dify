import { memo } from 'react'
import Card from './card'
import InstallFromMarketplace from './install-from-marketplace'
import { useGlobalPublicStore } from '@/context/global-public-context'
import { useGetDataSourceListAuth } from '@/service/use-datasource'

const DataSourcePage = () => {
  const { enable_marketplace } = useGlobalPublicStore(s => s.systemFeatures)
  const { data } = useGetDataSourceListAuth()

  return (
    <div>
      <div className='space-y-2'>
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
            searchText={''}
          />
        )
      }
    </div>
  )
}

export default memo(DataSourcePage)
