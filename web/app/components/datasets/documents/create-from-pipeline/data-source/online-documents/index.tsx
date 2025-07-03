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
import type { DataSourceNodeCompletedResponse } from '@/types/pipeline'
import type { DataSourceNodeType } from '@/app/components/workflow/nodes/data-source/types'
import { useDataSourceStore } from '../store'

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
  const documentsData = useDataSourceStore(state => state.documentsData)
  const setDocumentsData = useDataSourceStore(state => state.setDocumentsData)
  const searchValue = useDataSourceStore(state => state.searchValue)
  const setSearchValue = useDataSourceStore(state => state.setSearchValue)
  const currentWorkspaceId = useDataSourceStore(state => state.currentWorkspaceId)
  const setCurrentWorkspaceId = useDataSourceStore(state => state.setCurrentWorkspaceId)
  const setOnlineDocuments = useDataSourceStore(state => state.setOnlineDocuments)
  const setCurrentDocument = useDataSourceStore(state => state.setCurrentDocument)
  const selectedPagesId = useDataSourceStore(state => state.selectedPagesId)
  const setSelectedPagesId = useDataSourceStore(state => state.setSelectedPagesId)

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
          setDocumentsData(documentsData.data as DataSourceNotionWorkspace[])
          setCurrentWorkspaceId(documentsData.data[0].workspace_id)
        },
        onError: (message: string) => {
          Toast.notify({
            type: 'error',
            message,
          })
        },
      },
    )
  }, [datasourceNodeRunURL, setCurrentWorkspaceId, setDocumentsData])

  useEffect(() => {
    if (!documentsData.length)
      getOnlineDocuments()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const currentWorkspace = documentsData.find(workspace => workspace.workspace_id === currentWorkspaceId)

  const handleSearchValueChange = useCallback((value: string) => {
    setSearchValue(value)
  }, [setSearchValue])

  const handleSelectWorkspace = useCallback((workspaceId: string) => {
    setCurrentWorkspaceId(workspaceId)
  }, [setCurrentWorkspaceId])

  const handleSelectPages = useCallback((newSelectedPagesId: Set<string>) => {
    const selectedPages = Array.from(newSelectedPagesId).map(pageId => PagesMapAndSelectedPagesId[pageId])

    setSelectedPagesId(new Set(Array.from(newSelectedPagesId)))
    setOnlineDocuments(selectedPages)
  }, [setSelectedPagesId, setOnlineDocuments, PagesMapAndSelectedPagesId])

  const handlePreviewPage = useCallback((previewPageId: string) => {
    setCurrentDocument(PagesMapAndSelectedPagesId[previewPageId])
  }, [PagesMapAndSelectedPagesId, setCurrentDocument])

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
