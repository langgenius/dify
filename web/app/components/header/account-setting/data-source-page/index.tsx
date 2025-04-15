import useSWR from 'swr'
import DataSourceNotion from './data-source-notion'
import DataSourceWebsite from './data-source-website'
import { fetchDataSource } from '@/service/common'
import { DataSourceProvider } from '@/models/common'

export default function DataSourcePage() {
  const { data } = useSWR({ url: 'data-source/integrates' }, fetchDataSource)
  const notionWorkspaces = data?.data.filter(item => item.provider === 'notion') || []

  return (
    <div className='mb-8'>
      <DataSourceNotion workspaces={notionWorkspaces} />
      <DataSourceWebsite provider={DataSourceProvider.jinaReader} />
      <DataSourceWebsite provider={DataSourceProvider.fireCrawl} />
      <DataSourceWebsite provider={DataSourceProvider.waterCrawl} />
    </div>
  )
}
