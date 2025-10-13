import { useCallback, useEffect, useMemo, useState } from 'react'
import type { NotionCredential } from './credential-selector'
import WorkspaceSelector from './credential-selector'
import SearchInput from './search-input'
import PageSelector from './page-selector'
import type { DataSourceNotionPageMap, DataSourceNotionWorkspace, NotionPage } from '@/models/common'
import { useModalContextSelector } from '@/context/modal-context'
import NotionConnector from '../notion-connector'
import { useInvalidPreImportNotionPages, usePreImportNotionPages } from '@/service/knowledge/use-import'
import Header from '../../datasets/create/website/base/header'
import type { DataSourceCredential } from '../../header/account-setting/data-source-page-new/types'
import Loading from '../loading'

type NotionPageSelectorProps = {
  value?: string[]
  onSelect: (selectedPages: NotionPage[]) => void
  canPreview?: boolean
  previewPageId?: string
  onPreview?: (selectedPage: NotionPage) => void
  datasetId?: string
  credentialList: DataSourceCredential[]
  onSelectCredential?: (credentialId: string) => void
}

const NotionPageSelector = ({
  value,
  onSelect,
  canPreview,
  previewPageId,
  onPreview,
  datasetId = '',
  credentialList,
  onSelectCredential,
}: NotionPageSelectorProps) => {
  const [searchValue, setSearchValue] = useState('')
  const setShowAccountSettingModal = useModalContextSelector(s => s.setShowAccountSettingModal)

  const invalidPreImportNotionPages = useInvalidPreImportNotionPages()

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
    if (!credential) {
      const firstCredential = notionCredentials[0]
      invalidPreImportNotionPages({ datasetId, credentialId: firstCredential.credentialId })
      setCurrentCredential(notionCredentials[0])
      onSelect([]) // Clear selected pages when changing credential
      onSelectCredential?.(firstCredential.credentialId)
    }
    else {
      onSelectCredential?.(credential?.credentialId || '')
    }
  }, [notionCredentials])

  const {
    data: notionsPages,
    isFetching: isFetchingNotionPages,
    isError: isFetchingNotionPagesError,
  } = usePreImportNotionPages({ datasetId, credentialId: currentCredential.credentialId || '' })

  const pagesMapAndSelectedPagesId: [DataSourceNotionPageMap, Set<string>, Set<string>] = useMemo(() => {
    const selectedPagesId = new Set<string>()
    const boundPagesId = new Set<string>()
    const notionWorkspaces = notionsPages?.notion_info || []
    const pagesMap = notionWorkspaces.reduce((prev: DataSourceNotionPageMap, cur: DataSourceNotionWorkspace) => {
      cur.pages.forEach((page) => {
        if (page.is_bound) {
          selectedPagesId.add(page.page_id)
          boundPagesId.add(page.page_id)
        }
        prev[page.page_id] = {
          ...page,
          workspace_id: cur.workspace_id,
        }
      })

      return prev
    }, {})
    return [pagesMap, selectedPagesId, boundPagesId]
  }, [notionsPages?.notion_info])

  const defaultSelectedPagesId = useMemo(() => {
    return [...Array.from(pagesMapAndSelectedPagesId[1]), ...(value || [])]
  }, [pagesMapAndSelectedPagesId, value])
  const [selectedPagesId, setSelectedPagesId] = useState<Set<string>>(() => new Set(defaultSelectedPagesId))

  useEffect(() => {
    setSelectedPagesId(new Set(defaultSelectedPagesId))
  }, [defaultSelectedPagesId])

  const handleSearchValueChange = useCallback((value: string) => {
    setSearchValue(value)
  }, [])

  const handleSelectCredential = useCallback((credentialId: string) => {
    const credential = notionCredentials.find(item => item.credentialId === credentialId)!
    invalidPreImportNotionPages({ datasetId, credentialId: credential.credentialId })
    setCurrentCredential(credential)
    onSelect([]) // Clear selected pages when changing credential
    onSelectCredential?.(credential.credentialId)
  }, [invalidPreImportNotionPages, onSelect, onSelectCredential])

  const handleSelectPages = useCallback((newSelectedPagesId: Set<string>) => {
    const selectedPages = Array.from(newSelectedPagesId).map(pageId => pagesMapAndSelectedPagesId[0][pageId])

    setSelectedPagesId(new Set(Array.from(newSelectedPagesId)))
    onSelect(selectedPages)
  }, [pagesMapAndSelectedPagesId, onSelect])

  const handlePreviewPage = useCallback((previewPageId: string) => {
    if (onPreview)
      onPreview(pagesMapAndSelectedPagesId[0][previewPageId])
  }, [pagesMapAndSelectedPagesId, onPreview])

  const handleConfigureNotion = useCallback(() => {
    setShowAccountSettingModal({ payload: 'data-source' })
  }, [setShowAccountSettingModal])

  if (isFetchingNotionPagesError) {
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
          {isFetchingNotionPages ? (
            <div className='flex h-[296px] items-center justify-center'>
              <Loading />
            </div>
          ) : (
            <PageSelector
              value={selectedPagesId}
              disabledValue={pagesMapAndSelectedPagesId[2]}
              searchValue={searchValue}
              list={notionsPages!.notion_info?.[0].pages || []}
              pagesMap={pagesMapAndSelectedPagesId[0]}
              onSelect={handleSelectPages}
              canPreview={canPreview}
              previewPageId={previewPageId}
              onPreview={handlePreviewPage}
            />
          )}
        </div>
      </div>
    </div>
  )
}

export default NotionPageSelector
