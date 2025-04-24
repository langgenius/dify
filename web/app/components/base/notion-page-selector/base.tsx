import { useCallback, useEffect, useMemo, useState } from 'react'
import WorkspaceSelector from './workspace-selector'
import SearchInput from './search-input'
import PageSelector from './page-selector'
import type { DataSourceNotionPageMap, DataSourceNotionWorkspace, NotionPage } from '@/models/common'
import { useModalContextSelector } from '@/context/modal-context'
import NotionConnector from '../notion-connector'
import { usePreImportNotionPages } from '@/service/knowledge/use-import'
import Header from './header'

type NotionPageSelectorProps = {
  value?: string[]
  onSelect: (selectedPages: NotionPage[]) => void
  canPreview?: boolean
  previewPageId?: string
  onPreview?: (selectedPage: NotionPage) => void
  datasetId?: string
  isInPipeline?: boolean
}

const NotionPageSelector = ({
  value,
  onSelect,
  canPreview,
  previewPageId,
  onPreview,
  datasetId = '',
  isInPipeline = false,
}: NotionPageSelectorProps) => {
  const { data, refetch } = usePreImportNotionPages({ url: '/notion/pre-import/pages', datasetId })
  const [prevData, setPrevData] = useState(data)
  const [searchValue, setSearchValue] = useState('')
  const [currentWorkspaceId, setCurrentWorkspaceId] = useState('')
  const setShowAccountSettingModal = useModalContextSelector(s => s.setShowAccountSettingModal)

  const notionWorkspaces = useMemo(() => {
    return data?.notion_info || []
  }, [data?.notion_info])
  const firstWorkspaceId = notionWorkspaces[0]?.workspace_id
  const currentWorkspace = notionWorkspaces.find(workspace => workspace.workspace_id === currentWorkspaceId)

  const getPagesMapAndSelectedPagesId: [DataSourceNotionPageMap, Set<string>, Set<string>] = useMemo(() => {
    const selectedPagesId = new Set<string>()
    const boundPagesId = new Set<string>()
    const pagesMap = notionWorkspaces.reduce((prev: DataSourceNotionPageMap, next: DataSourceNotionWorkspace) => {
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
  const handleSelectPages = (newSelectedPagesId: Set<string>) => {
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

  const handleConfigureNotion = useCallback(() => {
    setShowAccountSettingModal({ payload: 'data-source', onCancelCallback: refetch })
  }, [setShowAccountSettingModal, refetch])

  return (
    <>
      {
        data?.notion_info?.length
          ? (
            <div className='flex flex-col gap-y-2'>
              <Header
                isInPipeline={isInPipeline}
                handleConfigureNotion={handleConfigureNotion}
              />
              <div className='rounded-xl border border-components-panel-border bg-background-default-subtle'>
                <div className='flex h-12 items-center gap-x-2 rounded-t-xl border-b border-b-divider-regular bg-components-panel-bg p-2'>
                  <div className='flex grow items-center gap-x-1'>
                    <WorkspaceSelector
                      value={currentWorkspaceId || firstWorkspaceId}
                      items={notionWorkspaces}
                      onSelect={handleSelectWorkspace}
                    />
                  </div>
                  <SearchInput
                    value={searchValue}
                    onChange={handleSearchValueChange}
                  />
                </div>
                <div className='overflow-hidden rounded-b-xl'>
                  <PageSelector
                    value={selectedPagesId}
                    disabledValue={getPagesMapAndSelectedPagesId[2]}
                    searchValue={searchValue}
                    list={currentWorkspace?.pages || []}
                    pagesMap={getPagesMapAndSelectedPagesId[0]}
                    onSelect={handleSelectPages}
                    canPreview={canPreview}
                    previewPageId={previewPageId}
                    onPreview={handlePreviewPage}
                  />
                </div>
              </div>
            </div>
          )
          : (
            <NotionConnector onSetting={handleConfigureNotion} />
          )
      }
    </>
  )
}

export default NotionPageSelector
