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
import { useGetDataSourceAuth } from '@/service/use-datasource'
import Loading from '@/app/components/base/loading'
import { useDocLink } from '@/context/i18n'

type OnlineDocumentsProps = {
  isInPipeline?: boolean
  nodeId: string
  nodeData: DataSourceNodeType
  onCredentialChange: (credentialId: string) => void
}

const OnlineDocuments = ({
  nodeId,
  nodeData,
  isInPipeline = false,
  onCredentialChange,
}: OnlineDocumentsProps) => {
  const docLink = useDocLink()
  const pipelineId = useDatasetDetailContextWithSelector(s => s.dataset?.pipeline_id)
  const setShowAccountSettingModal = useModalContextSelector(s => s.setShowAccountSettingModal)
  const {
    documentsData,
    searchValue,
    selectedPagesId,
    currentCredentialId,
  } = useDataSourceStoreWithSelector(useShallow(state => ({
    documentsData: state.documentsData,
    searchValue: state.searchValue,
    selectedPagesId: state.selectedPagesId,
    currentCredentialId: state.currentCredentialId,
  })))

  const { data: dataSourceAuth } = useGetDataSourceAuth({
    pluginId: nodeData.plugin_id,
    provider: nodeData.provider_name,
  })

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
    const { currentCredentialId } = dataSourceStore.getState()
    ssePost(
      datasourceNodeRunURL,
      {
        body: {
          inputs: {},
          credential_id: currentCredentialId,
          datasource_type: DatasourceType.onlineDocument,
        },
      },
      {
        onDataSourceNodeCompleted: (documentsData: DataSourceNodeCompletedResponse) => {
          const { setDocumentsData } = dataSourceStore.getState()
          setDocumentsData(documentsData.data as DataSourceNotionWorkspace[])
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
    if (!currentCredentialId) return
    getOnlineDocuments()
  }, [currentCredentialId])

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

  return (
    <div className='flex flex-col gap-y-2'>
      <Header
        docTitle='Docs'
        docLink={docLink('/guides/knowledge-base/knowledge-pipeline/authorize-data-source')}
        onClickConfiguration={handleSetting}
        pluginName={nodeData.datasource_label}
        currentCredentialId={currentCredentialId}
        onCredentialChange={onCredentialChange}
        credentials={dataSourceAuth?.result || []}
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
          {documentsData?.length ? (
            <PageSelector
              checkedIds={selectedPagesId}
              disabledValue={new Set()}
              searchValue={searchValue}
              list={documentsData[0].pages || []}
              pagesMap={PagesMapAndSelectedPagesId}
              onSelect={handleSelectPages}
              canPreview={!isInPipeline}
              onPreview={handlePreviewPage}
              isMultipleChoice={!isInPipeline}
              currentCredentialId={currentCredentialId}
            />
          ) : (
            <div className='flex h-[296px] items-center justify-center'>
              <Loading type='app' />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default OnlineDocuments
