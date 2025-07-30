import { useCallback, useEffect, useMemo, useState } from 'react'
import type { NotionCredential } from './credential-selector'
import WorkspaceSelector from './credential-selector'
import SearchInput from './search-input'
import PageSelector from './page-selector'
import type { DataSourceNotionPageMap, DataSourceNotionWorkspace, NotionPage } from '@/models/common'
import { useModalContextSelector } from '@/context/modal-context'
import NotionConnector from '../notion-connector'
import { usePreImportNotionPages } from '@/service/knowledge/use-import'
import Header from '../../datasets/create/website/base/header'
import type { DataSourceCredential } from '../../header/account-setting/data-source-page-new/types'

type NotionPageSelectorProps = {
  value?: string[]
  onSelect: (selectedPages: NotionPage[]) => void
  canPreview?: boolean
  previewPageId?: string
  onPreview?: (selectedPage: NotionPage) => void
  datasetId?: string
  credentialList: DataSourceCredential[]
}

const NotionPageSelector = ({
  value,
  onSelect,
  canPreview,
  previewPageId,
  onPreview,
  datasetId = '',
  credentialList,
}: NotionPageSelectorProps) => {
  const [searchValue, setSearchValue] = useState('')
  const setShowAccountSettingModal = useModalContextSelector(s => s.setShowAccountSettingModal)

  const notionCredentials = useMemo((): NotionCredential[] => {
    return credentialList.map((item) => {
      return {
        credentialId: item.id,
        credentialName: item.name,
        workspaceIcon: item.credential.workspace_icon,
        workspaceName: item.credential.workspace_name,
      }
    })
  }, [credentialList])
  const [currentCredential, setCurrentCredential] = useState(notionCredentials[0])

  useEffect(() => {
    const credential = notionCredentials.find(item => item.credentialId === currentCredential?.credentialId)
    if (!credential)
      setCurrentCredential(notionCredentials[0])
  }, [notionCredentials])

  const { data } = usePreImportNotionPages({ datasetId, credentialId: currentCredential.credentialId || '' })

  const getPagesMapAndSelectedPagesId: [DataSourceNotionPageMap, Set<string>, Set<string>] = useMemo(() => {
    const selectedPagesId = new Set<string>()
    const boundPagesId = new Set<string>()
    const notionWorkspaces = data?.notion_info || []
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
  }, [data?.notion_info])

  const defaultSelectedPagesId = [...Array.from(getPagesMapAndSelectedPagesId[1]), ...(value || [])]
  const [selectedPagesId, setSelectedPagesId] = useState<Set<string>>(new Set(defaultSelectedPagesId))

  useEffect(() => {
    setSelectedPagesId(new Set(defaultSelectedPagesId))
  }, [data])

  const handleSearchValueChange = useCallback((value: string) => {
    setSearchValue(value)
  }, [])

  const handleSelectCredential = useCallback((credentialId: string) => {
    const credential = notionCredentials.find(item => item.credentialId === credentialId)!
    setCurrentCredential(credential)
  }, [])

  const handleSelectPages = useCallback((newSelectedPagesId: Set<string>) => {
    const selectedPages = Array.from(newSelectedPagesId).map(pageId => getPagesMapAndSelectedPagesId[0][pageId])

    setSelectedPagesId(new Set(Array.from(newSelectedPagesId)))
    onSelect(selectedPages)
  }, [getPagesMapAndSelectedPagesId, onSelect])

  const handlePreviewPage = useCallback((previewPageId: string) => {
    if (onPreview)
      onPreview(getPagesMapAndSelectedPagesId[0][previewPageId])
  }, [getPagesMapAndSelectedPagesId, onSelect, onPreview])

  const handleConfigureNotion = useCallback(() => {
    setShowAccountSettingModal({ payload: 'data-source' })
  }, [setShowAccountSettingModal])

  if (!data) {
    return (
      <NotionConnector
        onSetting={handleConfigureNotion}
      />
    )
  }

  return (
    <div className='flex flex-col gap-y-2'>
      <Header
        onClickConfiguration={handleConfigureNotion}
        title={'Choose notion pages'}
        buttonText={'Configure Notion'}
        docTitle={'Notion docs'}
        docLink={'https://www.notion.so/docs'}
      />
      <div className='rounded-xl border border-components-panel-border bg-background-default-subtle'>
        <div className='flex h-12 items-center gap-x-2 rounded-t-xl border-b border-b-divider-regular bg-components-panel-bg p-2'>
          <div className='flex grow items-center gap-x-1'>
            <WorkspaceSelector
              value={currentCredential.credentialId}
              items={notionCredentials}
              onSelect={handleSelectCredential}
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
            list={data.notion_info?.[0].pages || []}
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
}

export default NotionPageSelector
