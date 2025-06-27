import { useCallback, useEffect, useMemo, useState } from 'react'
import WorkspaceSelector from '@/app/components/base/notion-page-selector/workspace-selector'
import SearchInput from '@/app/components/base/notion-page-selector/search-input'
import PageSelector from '@/app/components/base/notion-page-selector/page-selector'
import type { DataSourceNotionPageMap, DataSourceNotionWorkspace, NotionPage } from '@/models/common'
import Header from '@/app/components/datasets/create/website/base/header'
import { useDatasetDetailContextWithSelector } from '@/context/dataset-detail'
import { DatasourceType } from '@/models/pipeline'
import { ssePost } from '@/service/base'
import Toast from '@/app/components/base/toast'
import type { DataSourceNodeCompletedResponse } from '@/types/pipeline'
import type { DataSourceNodeType } from '@/app/components/workflow/nodes/data-source/types'

type OnlineDocumentsProps = {
  pageIdList?: string[]
  onSelect: (selectedPages: NotionPage[]) => void
  canPreview?: boolean
  previewPageId?: string
  onPreview?: (selectedPage: NotionPage) => void
  isInPipeline?: boolean
  nodeId: string
  nodeData: DataSourceNodeType
}

const OnlineDocuments = ({
  pageIdList,
  onSelect,
  canPreview,
  previewPageId,
  onPreview,
  isInPipeline = false,
  nodeId,
  nodeData,
}: OnlineDocumentsProps) => {
  const pipelineId = useDatasetDetailContextWithSelector(s => s.dataset?.pipeline_id)
  const [documentsData, setDocumentsData] = useState<DataSourceNotionWorkspace[]>([])
  const [searchValue, setSearchValue] = useState('')
  const [currentWorkspaceId, setCurrentWorkspaceId] = useState('')

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
        },
        onError: (message: string) => {
          Toast.notify({
            type: 'error',
            message,
          })
        },
      },
    )
  }, [datasourceNodeRunURL])

  useEffect(() => {
    getOnlineDocuments()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const firstWorkspaceId = documentsData[0]?.workspace_id
  const currentWorkspace = documentsData.find(workspace => workspace.workspace_id === currentWorkspaceId)

  const PagesMapAndSelectedPagesId: [DataSourceNotionPageMap, Set<string>, Set<string>] = useMemo(() => {
    const selectedPagesId = new Set<string>()
    const boundPagesId = new Set<string>()
    const pagesMap = documentsData.reduce((prev: DataSourceNotionPageMap, next: DataSourceNotionWorkspace) => {
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
  }, [documentsData])
  const defaultSelectedPagesId = [...Array.from(PagesMapAndSelectedPagesId[1]), ...(pageIdList || [])]
  const [selectedPagesId, setSelectedPagesId] = useState<Set<string>>(new Set(defaultSelectedPagesId))

  const handleSearchValueChange = useCallback((value: string) => {
    setSearchValue(value)
  }, [])
  const handleSelectWorkspace = useCallback((workspaceId: string) => {
    setCurrentWorkspaceId(workspaceId)
  }, [])
  const handleSelectPages = (newSelectedPagesId: Set<string>) => {
    const selectedPages = Array.from(newSelectedPagesId).map(pageId => PagesMapAndSelectedPagesId[0][pageId])

    setSelectedPagesId(new Set(Array.from(newSelectedPagesId)))
    onSelect(selectedPages)
  }
  const handlePreviewPage = (previewPageId: string) => {
    if (onPreview)
      onPreview(PagesMapAndSelectedPagesId[0][previewPageId])
  }

  useEffect(() => {
    setCurrentWorkspaceId(firstWorkspaceId)
  }, [firstWorkspaceId])

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
              value={currentWorkspaceId || firstWorkspaceId}
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
            value={selectedPagesId}
            disabledValue={PagesMapAndSelectedPagesId[2]}
            searchValue={searchValue}
            list={currentWorkspace?.pages || []}
            pagesMap={PagesMapAndSelectedPagesId[0]}
            onSelect={handleSelectPages}
            canPreview={canPreview}
            previewPageId={previewPageId}
            onPreview={handlePreviewPage}
          />
        </div>
      </div>
    </div>
  )
}

export default OnlineDocuments
