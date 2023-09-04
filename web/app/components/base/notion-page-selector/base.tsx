import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useContext } from 'use-context-selector'
import useSWR from 'swr'
import cn from 'classnames'
import s from './base.module.css'
import WorkspaceSelector from './workspace-selector'
import SearchInput from './search-input'
import PageSelector from './page-selector'
import { preImportNotionPages } from '@/service/datasets'
import AccountSetting from '@/app/components/header/account-setting'
import { NotionConnector } from '@/app/components/datasets/create/step-one'
import type { DataSourceNotionPageMap, DataSourceNotionWorkspace, NotionPage } from '@/models/common'
import { ToastContext } from '@/app/components/base/toast'


type NotionPageSelectorProps = {
  value?: string[]
  onSelect: (selectedPages: NotionPage[]) => void
  canPreview?: boolean
  previewPageId?: string
  onPreview?: (selectedPage: NotionPage) => void
  datasetId?: string
  countLimit: number
  countUsed: number
}

const NotionPageSelector = ({
  value,
  onSelect,
  canPreview,
  previewPageId,
  onPreview,
  datasetId = '',
  countLimit,
  countUsed,
}: NotionPageSelectorProps) => {
  const { t } = useTranslation()
  const { notify } = useContext(ToastContext)
  const { data, mutate } = useSWR({ url: '/notion/pre-import/pages', datasetId }, preImportNotionPages)
  const [prevData, setPrevData] = useState(data)
  const [searchValue, setSearchValue] = useState('')
  const [showDataSourceSetting, setShowDataSourceSetting] = useState(false)
  const [currentWorkspaceId, setCurrentWorkspaceId] = useState('')

  const notionWorkspaces = useMemo(() => {
    return data?.notion_info || []
  }, [data?.notion_info])
  const firstWorkspaceId = notionWorkspaces[0]?.workspace_id
  const currentWorkspace = notionWorkspaces.find(workspace => workspace.workspace_id === currentWorkspaceId)

  const getPagesMapAndSelectedPagesId: [DataSourceNotionPageMap, Set<string>] = useMemo(() => {
    const selectedPagesId = new Set<string>()
    const pagesMap = notionWorkspaces.reduce((prev: DataSourceNotionPageMap, next: DataSourceNotionWorkspace) => {
      next.pages.forEach((page) => {
        if (page.is_bound)
          selectedPagesId.add(page.page_id)
        prev[page.page_id] = {
          ...page,
          workspace_id: next.workspace_id,
        }
      })

      return prev
    }, {})
    return [pagesMap, selectedPagesId]
  }, [notionWorkspaces])
  const defaultSelectedPagesId = [...Array.from(getPagesMapAndSelectedPagesId[1]), ...(value || [])]
  const [selectedPagesId, setSelectedPagesId] = useState<Set<string>>(new Set(defaultSelectedPagesId))

  if (prevData !== data) {
    setPrevData(data)
    setSelectedPagesId(new Set(defaultSelectedPagesId))
  }

  const handleSearchValueChange = useCallback((value: string) => {
    setSearchValue(value)
  }, [])
  const handleSelectWorkspace = useCallback((workspaceId: string) => {
    setCurrentWorkspaceId(workspaceId)
  }, [])
  const handleSelecPages = (newSelectedPagesId: Set<string>) => {
    const selectedPages = Array.from(newSelectedPagesId).map(pageId => getPagesMapAndSelectedPagesId[0][pageId])
    if (selectedPages.length > countLimit - countUsed) {
      notify({ type: 'error', message: t('datasetCreation.stepOne.overCountLimit', { countLimit }) })
      return false
    }
    setSelectedPagesId(new Set(Array.from(newSelectedPagesId)))
    onSelect(selectedPages)
  }
  const handlePreviewPage = (previewPageId: string) => {
    if (onPreview)
      onPreview(getPagesMapAndSelectedPagesId[0][previewPageId])
  }

  useEffect(() => {
    setCurrentWorkspaceId(firstWorkspaceId)
  }, [firstWorkspaceId])

  return (
    <div className='bg-gray-25 border border-gray-200 rounded-xl'>
      {
        data?.notion_info?.length
          ? (
            <>
              <div className='flex items-center pl-[10px] pr-2 h-11 bg-white border-b border-b-gray-200 rounded-t-xl'>
                <WorkspaceSelector
                  value={currentWorkspaceId || firstWorkspaceId}
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
                <PageSelector
                  value={selectedPagesId}
                  searchValue={searchValue}
                  list={currentWorkspace?.pages || []}
                  pagesMap={getPagesMapAndSelectedPagesId[0]}
                  onSelect={handleSelecPages}
                  canPreview={canPreview}
                  previewPageId={previewPageId}
                  onPreview={handlePreviewPage}
                />
              </div>
            </>
          )
          : (
            <NotionConnector onSetting={() => setShowDataSourceSetting(true)} />
          )
      }
      {
        showDataSourceSetting && (
          <AccountSetting activeTab='data-source' onCancel={() => {
            setShowDataSourceSetting(false)
            mutate()
          }} />
        )
      }
    </div>
  )
}

export default NotionPageSelector
