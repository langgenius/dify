import { useCallback, useEffect, useState } from 'react'
import useSWR from 'swr'
import cn from 'classnames'
import s from './base.module.css'
import WorkspaceSelector from './workspace-selector'
import SearchInput from './search-input'
import PageSelector from './page-selector'
import { fetchDataSource } from '@/service/common'
import AccountSetting from '@/app/components/header/account-setting'
import type { DataSourceNotionPage } from '@/models/common'

type NotionPageSelectorProps = {
  onSelect: (selectedPages: (DataSourceNotionPage & { workspace_id: string })[]) => void
  canPreview?: boolean
  onPreview?: (selectedPage: DataSourceNotionPage & { workspace_id: string }) => void
}

const NotionPageSelector = ({
  onSelect,
  canPreview,
  onPreview,
}: NotionPageSelectorProps) => {
  const [searchValue, setSearchValue] = useState('')
  const [showDataSourceSetting, setShowDataSourceSetting] = useState(false)
  const { data } = useSWR({ url: 'data-source/integrates' }, fetchDataSource)
  const notionWorkspaces = data?.data.filter(item => item.provider === 'notion') || []
  const firstWorkspace = notionWorkspaces[0]?.id
  const [currentWorkspaceId, setCurrentWorkspaceId] = useState('')
  const currentWorkspace = notionWorkspaces.find(workspace => workspace.id === currentWorkspaceId)

  const handleSearchValueChange = (value: string) => {
    setSearchValue(value)
  }
  const handleSelectWorkspace = useCallback((workspaceId: string) => {
    setCurrentWorkspaceId(workspaceId)
  }, [])
  const handleSelecPages = (selectedPages: DataSourceNotionPage[]) => {
    onSelect(selectedPages.map((item) => {
      return {
        ...item,
        workspace_id: currentWorkspace?.source_info.workspace_id || '',
      }
    }))
  }
  const handlePreviewPage = (previewPage: DataSourceNotionPage) => {
    if (onPreview) {
      onPreview({
        ...previewPage,
        workspace_id: currentWorkspace?.source_info.workspace_id || '',
      })
    }
  }

  useEffect(() => {
    setCurrentWorkspaceId(firstWorkspace)
  }, [firstWorkspace])
  return (
    <div className='bg-gray-25 border border-gray-200 rounded-xl'>
      <div className='flex items-center pl-[10px] pr-2 h-11 bg-white border-b border-b-gray-200 rounded-t-xl'>
        <WorkspaceSelector
          value={currentWorkspaceId}
          items={notionWorkspaces}
          onSelect={handleSelectWorkspace}
        />
        <div className='mx-1 w-[1px] h-3 bg-gray-200' />
        <div
          className={cn(s['setting-icon'], 'w-6 h-6 cursor-pointer')}
          onClick={() => setShowDataSourceSetting(true)}
        />
        <div className='grow' />
        <SearchInput
          value={searchValue}
          onChange={handleSearchValueChange}
        />
      </div>
      <div className='rounded-b-xl overflow-hidden'>
        {
          currentWorkspace?.source_info.pages.length && (
            <PageSelector
              list={currentWorkspace?.source_info.pages}
              onSelect={handleSelecPages}
              canPreview={canPreview}
              onPreview={handlePreviewPage}
            />
          )
        }
      </div>
      {
        showDataSourceSetting && (
          <AccountSetting activeTab='data-source' onCancel={() => {
            setShowDataSourceSetting(false)
          }} />
        )
      }
    </div>
  )
}

export default NotionPageSelector
