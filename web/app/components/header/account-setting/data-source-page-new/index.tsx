import { memo } from 'react'
import Card from './card'
import InstallFromMarketplace from './install-from-marketplace'
import { useGlobalPublicStore } from '@/context/global-public-context'

const DataSourcePage = () => {
  const { enable_marketplace } = useGlobalPublicStore(s => s.systemFeatures)
  return (
    <div>
      <div className='space-y-2'>
        <Card />
        <Card />
      </div>
      {
        enable_marketplace && (
          <InstallFromMarketplace
            providers={[]}
            searchText={''}
          />
        )
      }
    </div>
  )
}

export default memo(DataSourcePage)
