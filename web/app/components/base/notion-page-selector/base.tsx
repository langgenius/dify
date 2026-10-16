import type { NotionIntegrateInfoListResponse } from '@dify/contracts/api/console/notion/types.gen'
import type { DataSourceCredential } from '../../header/account-setting/data-source-page-new/types'
import type { NotionCredential } from './credential-selector'
import type {
  DataSourceNotionPageMap,
  DataSourceNotionWorkspace,
  NotionPage,
} from '@/models/common'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useQueryState } from 'nuqs'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { LoadingPlaceholder } from '@/app/components/base/loading-placeholder'
import {
  settingsQueryParamName,
  settingsQueryParser,
} from '@/app/components/header/account-setting/query-params'
import { consoleQuery } from '@/service/console'
import Header from '../../datasets/create/website/base/header'
import NotionConnector from '../notion-connector'
import WorkspaceSelector from './credential-selector'
import PageSelector from './page-selector'
import SearchInput from './search-input'

// Top-level pages have no parent in the API response; the page tree calls them `root`.
const toNotionWorkspaces = ({ notion_info }: NotionIntegrateInfoListResponse) =>
  notion_info.map((workspace): DataSourceNotionWorkspace => ({
    ...workspace,
    workspace_id: workspace.workspace_id ?? '',
    workspace_name: workspace.workspace_name ?? '',
    pages: workspace.pages.map((page) => ({
      ...page,
      parent_id: page.parent_id ?? 'root',
      page_icon: page.page_icon && {
        type: page.page_icon.type ?? null,
        url: page.page_icon.url ?? null,
        emoji: page.page_icon.emoji ?? null,
      },
    })),
  }))

const getStringField = (record: Record<string, unknown>, key: string) => {
  const value = record[key]
  return typeof value === 'string' ? value : undefined
}

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
  const { t } = useTranslation(['common'])
  const [searchValue, setSearchValue] = useState('')
  const [, setSettingsDestination] = useQueryState(settingsQueryParamName, settingsQueryParser)

  const queryClient = useQueryClient()
  const invalidPreImportNotionPages = useCallback(
    ({ datasetId, credentialId }: { datasetId: string; credentialId: string }) =>
      queryClient.invalidateQueries({
        queryKey: consoleQuery.notion.preImport.pages.get.queryKey({
          input: { query: { dataset_id: datasetId, credential_id: credentialId } },
        }),
      }),
    [queryClient],
  )

  const notionCredentials = useMemo((): NotionCredential[] => {
    return credentialList.map((item) => {
      return {
        credentialId: item.id,
        credentialName: item.name,
        workspaceIcon: getStringField(item.credential, 'workspace_icon'),
        workspaceName: getStringField(item.credential, 'workspace_name'),
      }
    })
  }, [credentialList])
  const [selectedCredentialId, setSelectedCredentialId] = useState(
    () => notionCredentials[0]?.credentialId ?? '',
  )
  const currentCredential = useMemo(() => {
    return (
      notionCredentials.find((item) => item.credentialId === selectedCredentialId) ??
      notionCredentials[0] ??
      null
    )
  }, [notionCredentials, selectedCredentialId])
  const currentCredentialId = currentCredential?.credentialId ?? ''

  useEffect(() => {
    onSelectCredential?.(currentCredentialId)
  }, [currentCredentialId, onSelectCredential])

  useEffect(() => {
    if (!notionCredentials.length) {
      onSelect([])
      return
    }

    if (!selectedCredentialId || selectedCredentialId === currentCredentialId) return

    invalidPreImportNotionPages({ datasetId, credentialId: currentCredentialId })
    onSelect([])
  }, [
    currentCredentialId,
    datasetId,
    invalidPreImportNotionPages,
    notionCredentials.length,
    onSelect,
    selectedCredentialId,
  ])

  const {
    data: notionsPages,
    isFetching: isFetchingNotionPages,
    isError: isFetchingNotionPagesError,
  } = useQuery(
    consoleQuery.notion.preImport.pages.get.queryOptions({
      input: { query: { dataset_id: datasetId, credential_id: currentCredentialId } },
      retry: 0,
      select: toNotionWorkspaces,
    }),
  )
  const notionPages = notionsPages?.flatMap((workspace) => workspace.pages) || []

  const pagesMapAndSelectedPagesId: [DataSourceNotionPageMap, Set<string>, Set<string>] =
    useMemo(() => {
      const selectedPagesId = new Set<string>()
      const boundPagesId = new Set<string>()
      const notionWorkspaces = notionsPages || []
      const pagesMap = notionWorkspaces.reduce(
        (prev: DataSourceNotionPageMap, cur: DataSourceNotionWorkspace) => {
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
        },
        {},
      )
      return [pagesMap, selectedPagesId, boundPagesId]
    }, [notionsPages])

  const defaultSelectedPagesId = useMemo(() => {
    return [...Array.from(pagesMapAndSelectedPagesId[1]), ...(value || [])]
  }, [pagesMapAndSelectedPagesId, value])
  const selectedPagesId = useMemo(() => new Set(defaultSelectedPagesId), [defaultSelectedPagesId])

  const handleSearchValueChange = useCallback((value: string) => {
    setSearchValue(value)
  }, [])

  const handleSelectCredential = useCallback(
    (credentialId: string) => {
      if (credentialId === currentCredentialId) return

      invalidPreImportNotionPages({ datasetId, credentialId })
      setSelectedCredentialId(credentialId)
      onSelect([]) // Clear selected pages when changing credential
    },
    [currentCredentialId, datasetId, invalidPreImportNotionPages, onSelect],
  )

  const handleSelectPages = useCallback(
    (newSelectedPagesId: Set<string>) => {
      const selectedPages = Array.from(newSelectedPagesId).map(
        (pageId) => pagesMapAndSelectedPagesId[0][pageId]!,
      )

      onSelect(selectedPages)
    },
    [pagesMapAndSelectedPagesId, onSelect],
  )

  const handlePreviewPage = useCallback(
    (previewPageId: string) => {
      if (onPreview) onPreview(pagesMapAndSelectedPagesId[0][previewPageId]!)
    },
    [pagesMapAndSelectedPagesId, onPreview],
  )

  const handleConfigureNotion = useCallback(() => {
    setSettingsDestination('data-source')
  }, [setSettingsDestination])

  if (isFetchingNotionPagesError) {
    return <NotionConnector onSetting={handleConfigureNotion} />
  }

  return (
    <div className="flex flex-col gap-y-2" data-testid="notion-page-selector-base">
      <Header
        onClickConfiguration={handleConfigureNotion}
        title={t(($) => $['dataSource.notion.selector.headerTitle'], { ns: 'common' })}
        buttonText={t(($) => $['dataSource.notion.selector.configure'], { ns: 'common' })}
        docTitle={t(($) => $['dataSource.notion.selector.docs'], { ns: 'common' })}
        docLink="https://www.notion.so/docs"
      />
      <div className="rounded-xl border border-components-panel-border bg-background-default-subtle">
        <div className="flex h-12 items-center gap-x-2 rounded-t-xl border-b border-b-divider-regular bg-components-panel-bg p-2">
          <div className="flex grow items-center gap-x-1">
            <WorkspaceSelector
              value={currentCredentialId}
              items={notionCredentials}
              onSelect={handleSelectCredential}
            />
          </div>
          <SearchInput value={searchValue} onChange={handleSearchValueChange} />
        </div>
        <div className="overflow-hidden rounded-b-xl">
          {isFetchingNotionPages ? (
            <div
              className="flex h-74 items-center justify-center"
              data-testid="notion-page-selector-loading"
            >
              <LoadingPlaceholder />
            </div>
          ) : (
            <PageSelector
              key={currentCredentialId || 'default'}
              value={selectedPagesId}
              disabledValue={pagesMapAndSelectedPagesId[2]}
              searchValue={searchValue}
              list={notionPages}
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
