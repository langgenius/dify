import useSWR from 'swr'
import { useTranslation } from 'react-i18next'
import DataSourceNotion from './data-source-notion'
import DataSourceWebsite from './data-source-website'
import { fetchDataSource } from '@/service/common'

export default function DataSourcePage() {
  const { t } = useTranslation()
  const { data } = useSWR({ url: 'data-source/integrates' }, fetchDataSource)
  const notionWorkspaces = data?.data.filter(item => item.provider === 'notion') || []

  return (
    <div className='mb-8'>
      <div className='mb-2 text-sm font-medium text-gray-900'>{t('common.dataSource.add')}</div>
      <DataSourceNotion workspaces={notionWorkspaces} />
      <DataSourceWebsite />
    </div>
  )
}
