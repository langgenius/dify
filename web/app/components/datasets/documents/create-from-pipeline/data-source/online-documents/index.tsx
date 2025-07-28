import { useCallback, useEffect, useMemo } from 'react'
import SearchInput from '@/app/components/base/notion-page-selector/search-input'
import PageSelector from './page-selector'
import type { DataSourceNotionPageMap, DataSourceNotionWorkspace } from '@/models/common'
import Header from '../base/header'
import { useDatasetDetailContextWithSelector } from '@/context/dataset-detail'
import { DatasourceType } from '@/models/pipeline'
import { ssePost } from '@/service/base'
import Toast from '@/app/components/base/toast'
import type { DataSourceNodeCompletedResponse, DataSourceNodeErrorResponse } from '@/types/pipeline'
import type { DataSourceNodeType } from '@/app/components/workflow/nodes/data-source/types'
import { useDataSourceStore, useDataSourceStoreWithSelector } from '../store'
import { useShallow } from 'zustand/react/shallow'
import { useModalContextSelector } from '@/context/modal-context'
import Title from './title'
import { CredentialTypeEnum } from '@/app/components/plugins/plugin-auth'
import { noop } from 'lodash-es'

type OnlineDocumentsProps = {
  isInPipeline?: boolean
  nodeId: string
  nodeData: DataSourceNodeType
}

const OnlineDocuments = ({
  nodeId,
  nodeData,
  isInPipeline = false,
}: OnlineDocumentsProps) => {
  const pipelineId = useDatasetDetailContextWithSelector(s => s.dataset?.pipeline_id)
  const setShowAccountSettingModal = useModalContextSelector(s => s.setShowAccountSettingModal)
  const {
    documentsData,
    searchValue,
    selectedPagesId,
    currentWorkspaceId,
  } = useDataSourceStoreWithSelector(useShallow(state => ({
    documentsData: state.documentsData,
    searchValue: state.searchValue,
    selectedPagesId: state.selectedPagesId,
    currentWorkspaceId: state.currentWorkspaceId,
  })))
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
    const {
      setDocumentsData,
      setCurrentWorkspaceId,
      setSearchValue,
      setSelectedPagesId,
      setOnlineDocuments,
      setCurrentDocument,
      currentNodeIdRef,
    } = dataSourceStore.getState()
    if (nodeId !== currentNodeIdRef.current) {
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
  }, [nodeId])

  const currentWorkspace = documentsData.find(workspace => workspace.workspace_id === currentWorkspaceId)

  const handleSearchValueChange = useCallback((value: string) => {
    const { setSearchValue } = dataSourceStore.getState()
    setSearchValue(value)
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

  const handleSetting = useCallback(() => {
    setShowAccountSettingModal({
      payload: 'data-source',
    })
  }, [setShowAccountSettingModal])

  if (!documentsData?.length)
    return null

  return (
    <div className='flex flex-col gap-y-2'>
      <Header
        // todo: delete mock data
        docTitle='How to use?'
        docLink='https://docs.dify.ai'
        onClickConfiguration={handleSetting}
        pluginName={nodeData.datasource_label}
        currentCredentialId={'12345678'}
        onCredentialChange={noop}
        credentials={[{
          avatar_url: 'https://cloud.dify.ai/logo/logo.svg',
          credential: {
            credentials: '......',
          },
          id: '12345678',
          is_default: true,
          name: 'test123',
          type: CredentialTypeEnum.API_KEY,
        }]}
      />
      <div className='rounded-xl border border-components-panel-border bg-background-default-subtle'>
        <div className='flex items-center gap-x-2 rounded-t-xl border-b border-b-divider-regular bg-components-panel-bg p-1 pl-3'>
          <div className='flex grow items-center'>
            <Title name={nodeData.datasource_label} />
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
