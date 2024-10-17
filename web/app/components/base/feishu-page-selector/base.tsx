import { useCallback, useEffect, useMemo, useState } from 'react'
import useSWR from 'swr'
import cn from 'classnames'
import { FeishuProvider } from '../../header/account-setting/data-source-page/data-source-feishu/constants'
import s from './base.module.css'
import WorkspaceSelector from './workspace-selector'
import SearchInput from './search-input'
import PageSelector from './page-selector'
import { preImportFeishuPages } from '@/service/datasets'
import { FeishuConnector } from '@/app/components/datasets/create/step-one'
import type { DataSourceFeishuPageMap, DataSourceFeishuWorkspace, FeishuPage } from '@/models/common'
import { useModalContext } from '@/context/modal-context'

type FeishuPageSelectorProps = {
  value?: string[]
  onSelect: (selectedPages: FeishuPage[]) => void
  canPreview?: boolean
  previewPageId?: string
  onPreview?: (selectedPage: FeishuPage) => void
  datasetId?: string
}

const FeishuPageSelector = ({
  value,
  onSelect,
  canPreview,
  previewPageId,
  onPreview,
  datasetId = '',
}: FeishuPageSelectorProps) => {
  const { data, mutate } = useSWR({ url: `/${FeishuProvider}/pre-import/pages`, datasetId }, preImportFeishuPages)
  const [prevData, setPrevData] = useState(data)
  const [searchValue, setSearchValue] = useState('')
  const [currentWorkspaceId, setCurrentWorkspaceId] = useState('')
  const { setShowAccountSettingModal } = useModalContext()

  const feishuWorkspaces = useMemo(() => {
    return data?.feishuwiki_info || []
  }, [data?.feishuwiki_info])
  const firstWorkspaceId = feishuWorkspaces[0]?.workspace_id
  const currentWorkspace = feishuWorkspaces.find(workspace => workspace.workspace_id === currentWorkspaceId)

  const getPagesMapAndSelectedPagesId: [DataSourceFeishuPageMap, Set<string>, Set<string>] = useMemo(() => {
    const selectedPagesId = new Set<string>()
    const boundPagesId = new Set<string>()
    const pagesMap = feishuWorkspaces.reduce((prev: DataSourceFeishuPageMap, next: DataSourceFeishuWorkspace) => {
      next.pages.forEach((page) => {
        if (page.is_bound) {
          selectedPagesId.add(page.page_id)
          boundPagesId.add(page.page_id)
        }
        prev[page.page_id] = {
          ...page,
          workspace_id: next.workspace_id,
        }
      })

      return prev
    }, {})
    return [pagesMap, selectedPagesId, boundPagesId]
  }, [feishuWorkspaces])
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
        data?.feishuwiki_info?.length
          ? (
            <>
              <div className='flex items-center pl-[10px] pr-2 h-11 bg-white border-b border-b-gray-200 rounded-t-xl'>
                <WorkspaceSelector
                  value={currentWorkspaceId || firstWorkspaceId}
                  items={feishuWorkspaces}
                  onSelect={handleSelectWorkspace}
                />
                <div className='mx-1 w-[1px] h-3 bg-gray-200' />
                <div
                  className={cn(s['setting-icon'], 'w-6 h-6 cursor-pointer')}
                  onClick={() => setShowAccountSettingModal({ payload: 'data-source', onCancelCallback: mutate })}
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
                  disabledValue={getPagesMapAndSelectedPagesId[2]}
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
            <FeishuConnector onSetting={() => setShowAccountSettingModal({ payload: 'data-source', onCancelCallback: mutate })} />
          )
      }
    </div>
  )
}

export default FeishuPageSelector
