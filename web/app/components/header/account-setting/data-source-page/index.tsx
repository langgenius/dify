import useSWR from 'swr'
import DataSourceNotion from './data-source-notion'
import DataSourceWebsite from './data-source-website'
import { fetchDataSource } from '@/service/common'
import { DataSourceProvider } from '@/models/common'
import { ENABLE_WEBSITE_FIRECRAWL, ENABLE_WEBSITE_JINAREADER, ENABLE_WEBSITE_WATERCRAWL } from '@/config'

export default function DataSourcePage() {
  const { data } = useSWR({ url: 'data-source/integrates' }, fetchDataSource)
  const notionWorkspaces = data?.data.filter(item => item.provider === 'notion') || []

  return (
    <div className='mb-8'>
      <DataSourceNotion workspaces={notionWorkspaces} />
      {ENABLE_WEBSITE_JINAREADER && <DataSourceWebsite provider={DataSourceProvider.jinaReader} />}
      {ENABLE_WEBSITE_FIRECRAWL && <DataSourceWebsite provider={DataSourceProvider.fireCrawl} />}
      {ENABLE_WEBSITE_WATERCRAWL && <DataSourceWebsite provider={DataSourceProvider.waterCrawl} />}
    </div>
  )
}
