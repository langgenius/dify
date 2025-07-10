import { useCallback, useEffect, useMemo } from 'react'
import WorkspaceSelector from '@/app/components/base/notion-page-selector/workspace-selector'
import SearchInput from '@/app/components/base/notion-page-selector/search-input'
import PageSelector from './page-selector'
import type { DataSourceNotionPageMap, DataSourceNotionWorkspace } from '@/models/common'
import Header from '@/app/components/datasets/create/website/base/header'
import { useDatasetDetailContextWithSelector } from '@/context/dataset-detail'
import { DatasourceType } from '@/models/pipeline'
import { ssePost } from '@/service/base'
import Toast from '@/app/components/base/toast'
import type { DataSourceNodeCompletedResponse, DataSourceNodeErrorResponse } from '@/types/pipeline'
import type { DataSourceNodeType } from '@/app/components/workflow/nodes/data-source/types'
import { useDataSourceStore, useDataSourceStoreWithSelector } from '../store'

type OnlineDocumentsProps = {
  isInPipeline?: boolean
  nodeId: string
  nodeData: DataSourceNodeType
}

const OnlineDocuments = ({
  isInPipeline = false,
  nodeId,
  nodeData,
}: OnlineDocumentsProps) => {
  const pipelineId = useDatasetDetailContextWithSelector(s => s.dataset?.pipeline_id)
  const documentsData = useDataSourceStoreWithSelector(state => state.documentsData)
  const searchValue = useDataSourceStoreWithSelector(state => state.searchValue)
  const selectedPagesId = useDataSourceStoreWithSelector(state => state.selectedPagesId)
  const currentWorkspaceId = useDataSourceStoreWithSelector(state => state.currentWorkspaceId)
  const currentNodeIdRef = useDataSourceStoreWithSelector(state => state.currentNodeIdRef)
  const dataSourceStore = useDataSourceStore()

  const PagesMapAndSelectedPagesId: DataSourceNotionPageMap = useMemo(() => {
    const pagesMap = (documentsData || []).reduce((prev: DataSourceNotionPageMap, next: DataSourceNotionWorkspace) => {
      next.pages.forEach((page) => {
        prev[page.page_id] = {
          ...page,
          workspace_id: next.workspace_id,
        }
      })

      return prev
    }, {})
    return pagesMap
  }, [documentsData])

  const datasourceNodeRunURL = !isInPipeline
    ? `/rag/pipelines/${pipelineId}/workflows/published/datasource/nodes/${nodeId}/run`
    : `/rag/pipelines/${pipelineId}/workflows/draft/datasource/nodes/${nodeId}/run`

  const getOnlineDocuments = useCallback(async () => {
    ssePost(
      datasourceNodeRunURL,
      {
        body: {
          inputs: {},
          datasource_type: DatasourceType.onlineDocument,
        },
      },
      {
        onDataSourceNodeCompleted: (documentsData: DataSourceNodeCompletedResponse) => {
          const { setDocumentsData, setCurrentWorkspaceId } = dataSourceStore.getState()
          setDocumentsData(documentsData.data as DataSourceNotionWorkspace[])
          setCurrentWorkspaceId(documentsData.data[0].workspace_id)
        },
        onDataSourceNodeError: (error: DataSourceNodeErrorResponse) => {
          Toast.notify({
            type: 'error',
            message: error.error,
          })
        },
      },
    )
  }, [dataSourceStore, datasourceNodeRunURL])

  useEffect(() => {
    if (nodeId !== currentNodeIdRef.current) {
      const {
        setDocumentsData,
        setCurrentWorkspaceId,
        setSearchValue,
        setSelectedPagesId,
        setOnlineDocuments,
        setCurrentDocument,
      } = dataSourceStore.getState()
      setDocumentsData([])
      setCurrentWorkspaceId('')
      setSearchValue('')
      setSelectedPagesId(new Set())
      setOnlineDocuments([])
      setCurrentDocument(undefined)
      currentNodeIdRef.current = nodeId
      getOnlineDocuments()
    }
    else {
      // Avoid fetching documents when come back from next step
      if (!documentsData.length)
        getOnlineDocuments()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodeId])

  const currentWorkspace = documentsData.find(workspace => workspace.workspace_id === currentWorkspaceId)

  const handleSearchValueChange = useCallback((value: string) => {
    const { setSearchValue } = dataSourceStore.getState()
    setSearchValue(value)
  }, [dataSourceStore])

  const handleSelectWorkspace = useCallback((workspaceId: string) => {
    const { setCurrentWorkspaceId } = dataSourceStore.getState()
    setCurrentWorkspaceId(workspaceId)
  }, [dataSourceStore])

  const handleSelectPages = useCallback((newSelectedPagesId: Set<string>) => {
    const { setSelectedPagesId, setOnlineDocuments } = dataSourceStore.getState()
    const selectedPages = Array.from(newSelectedPagesId).map(pageId => PagesMapAndSelectedPagesId[pageId])
    setSelectedPagesId(new Set(Array.from(newSelectedPagesId)))
    setOnlineDocuments(selectedPages)
  }, [dataSourceStore, PagesMapAndSelectedPagesId])

  const handlePreviewPage = useCallback((previewPageId: string) => {
    const { setCurrentDocument } = dataSourceStore.getState()
    setCurrentDocument(PagesMapAndSelectedPagesId[previewPageId])
  }, [PagesMapAndSelectedPagesId, dataSourceStore])

  const headerInfo = useMemo(() => {
    return {
      title: nodeData.title,
      docTitle: 'How to use?',
      docLink: 'https://docs.dify.ai',
    }
  }, [nodeData])

  if (!documentsData?.length)
    return null

  return (
    <div className='flex flex-col gap-y-2'>
      <Header
        isInPipeline={isInPipeline}
        {...headerInfo}
      />
      <div className='rounded-xl border border-components-panel-border bg-background-default-subtle'>
        <div className='flex h-12 items-center gap-x-2 rounded-t-xl border-b border-b-divider-regular bg-components-panel-bg p-2'>
          <div className='flex grow items-center gap-x-1'>
            <WorkspaceSelector
              value={currentWorkspaceId}
              items={documentsData}
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
            checkedIds={selectedPagesId}
            disabledValue={new Set()}
            searchValue={searchValue}
            list={currentWorkspace?.pages || []}
            pagesMap={PagesMapAndSelectedPagesId}
            onSelect={handleSelectPages}
            canPreview={!isInPipeline}
            onPreview={handlePreviewPage}
            isMultipleChoice={!isInPipeline}
            currentWorkspaceId={currentWorkspaceId}
          />
        </div>
      </div>
    </div>
  )
}

export default OnlineDocuments
