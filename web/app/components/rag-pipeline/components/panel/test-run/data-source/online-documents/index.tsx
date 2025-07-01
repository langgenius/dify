import { useCallback, useEffect, useMemo } from 'react'
import WorkspaceSelector from '@/app/components/base/notion-page-selector/workspace-selector'
import SearchInput from '@/app/components/base/notion-page-selector/search-input'
import PageSelector from './page-selector'
import type { DataSourceNotionPageMap, DataSourceNotionWorkspace, NotionPage } from '@/models/common'
import Header from '@/app/components/datasets/create/website/base/header'
import { useDatasetDetailContextWithSelector } from '@/context/dataset-detail'
import { DatasourceType } from '@/models/pipeline'
import { ssePost } from '@/service/base'
import Toast from '@/app/components/base/toast'
import type { DataSourceNodeCompletedResponse } from '@/types/pipeline'
import type { DataSourceNodeType } from '@/app/components/workflow/nodes/data-source/types'

type OnlineDocumentsProps = {
  onSelect: (selectedPages: NotionPage[]) => void
  previewPageId?: string
  onPreview?: (selectedPage: NotionPage) => void
  isInPipeline?: boolean
  nodeId: string
  nodeData: DataSourceNodeType
  documentsData: DataSourceNotionWorkspace[]
  setDocumentsData: (documentsData: DataSourceNotionWorkspace[]) => void
  searchValue: string
  setSearchValue: (value: string) => void
  currentWorkspaceId: string
  setCurrentWorkspaceId: (workspaceId: string) => void
  PagesMapAndSelectedPagesId: [DataSourceNotionPageMap, Set<string>, Set<string>]
  selectedPagesId: Set<string>
  setSelectedPagesId: (selectedPagesId: Set<string>) => void
}

const OnlineDocuments = ({
  onSelect,
  previewPageId,
  onPreview,
  isInPipeline = false,
  nodeId,
  nodeData,
  documentsData,
  setDocumentsData,
  searchValue,
  setSearchValue,
  currentWorkspaceId,
  setCurrentWorkspaceId,
  PagesMapAndSelectedPagesId,
  selectedPagesId,
  setSelectedPagesId,
}: OnlineDocumentsProps) => {
  const pipelineId = useDatasetDetailContextWithSelector(s => s.dataset?.pipeline_id)

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
    const selectedPages = Array.from(newSelectedPagesId).map(pageId => PagesMapAndSelectedPagesId[0][pageId])

    setSelectedPagesId(new Set(Array.from(newSelectedPagesId)))
    onSelect(selectedPages)
  }, [setSelectedPagesId, onSelect, PagesMapAndSelectedPagesId])

  const handlePreviewPage = useCallback((previewPageId: string) => {
    if (onPreview)
      onPreview(PagesMapAndSelectedPagesId[0][previewPageId])
  }, [PagesMapAndSelectedPagesId, onPreview])

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
            disabledValue={PagesMapAndSelectedPagesId[2]}
            searchValue={searchValue}
            list={currentWorkspace?.pages || []}
            pagesMap={PagesMapAndSelectedPagesId[0]}
            onSelect={handleSelectPages}
            canPreview={!isInPipeline}
            previewPageId={previewPageId}
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
