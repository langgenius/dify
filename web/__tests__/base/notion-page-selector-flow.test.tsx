import type { DataSourceCredential } from '@/app/components/header/account-setting/data-source-page-new/types'
import type { DataSourceNotionWorkspace } from '@/models/common'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import NotionPageSelector from '@/app/components/base/notion-page-selector/base'
import { ACCOUNT_SETTING_TAB } from '@/app/components/header/account-setting/constants'
import { CredentialTypeEnum } from '@/app/components/plugins/plugin-auth/types'

const mockInvalidPreImportNotionPages = vi.fn()
const mockSetShowAccountSettingModal = vi.fn()
const mockUsePreImportNotionPages = vi.fn()

vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: ({ count }: { count: number }) => ({
    getVirtualItems: () => Array.from({ length: count }, (_, index) => ({
      index,
      size: 28,
      start: index * 28,
    })),
    getTotalSize: () => count * 28 + 16,
  }),
}))

vi.mock('@/service/knowledge/use-import', () => ({
  usePreImportNotionPages: (params: { datasetId: string, credentialId: string }) => mockUsePreImportNotionPages(params),
  useInvalidPreImportNotionPages: () => mockInvalidPreImportNotionPages,
}))

vi.mock('@/context/modal-context', () => ({
  useModalContextSelector: (selector: (state: { setShowAccountSettingModal: typeof mockSetShowAccountSettingModal }) => unknown) =>
    selector({ setShowAccountSettingModal: mockSetShowAccountSettingModal }),
}))

const buildCredential = (id: string, name: string, workspaceName: string): DataSourceCredential => ({
  id,
  name,
  type: CredentialTypeEnum.OAUTH2,
  is_default: false,
  avatar_url: '',
  credential: {
    workspace_icon: '',
    workspace_name: workspaceName,
  },
})

const credentials: DataSourceCredential[] = [
  buildCredential('c1', 'Cred 1', 'Workspace 1'),
  buildCredential('c2', 'Cred 2', 'Workspace 2'),
]

const workspacePagesByCredential: Record<string, DataSourceNotionWorkspace[]> = {
  c1: [
    {
      workspace_id: 'w1',
      workspace_icon: '',
      workspace_name: 'Workspace 1',
      pages: [
        { page_id: 'root-1', page_name: 'Root 1', parent_id: 'root', page_icon: null, type: 'page', is_bound: false },
        { page_id: 'child-1', page_name: 'Child 1', parent_id: 'root-1', page_icon: null, type: 'page', is_bound: false },
        { page_id: 'bound-1', page_name: 'Bound 1', parent_id: 'root', page_icon: null, type: 'page', is_bound: true },
      ],
    },
  ],
  c2: [
    {
      workspace_id: 'w2',
      workspace_icon: '',
      workspace_name: 'Workspace 2',
      pages: [
        { page_id: 'external-1', page_name: 'External 1', parent_id: 'root', page_icon: null, type: 'page', is_bound: false },
      ],
    },
  ],
}

describe('Base Notion Page Selector Flow', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUsePreImportNotionPages.mockImplementation(({ credentialId }: { credentialId: string }) => ({
      data: {
        notion_info: workspacePagesByCredential[credentialId] ?? workspacePagesByCredential.c1,
      },
      isFetching: false,
      isError: false,
    }))
  })

  it('selects a page tree, filters through search, clears search, and previews the current page', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    const onPreview = vi.fn()

    render(
      <NotionPageSelector
        credentialList={credentials}
        onSelect={onSelect}
        onPreview={onPreview}
        previewPageId="root-1"
      />,
    )

    await user.click(screen.getByTestId('checkbox-notion-page-checkbox-root-1'))

    expect(onSelect).toHaveBeenLastCalledWith(expect.arrayContaining([
      expect.objectContaining({ page_id: 'root-1', workspace_id: 'w1' }),
      expect.objectContaining({ page_id: 'child-1', workspace_id: 'w1' }),
      expect.objectContaining({ page_id: 'bound-1', workspace_id: 'w1' }),
    ]))

    await user.type(screen.getByTestId('notion-search-input'), 'missing-page')
    expect(screen.getByText('common.dataSource.notion.selector.noSearchResult')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'common.operation.clear' }))
    expect(screen.getByTestId('notion-page-name-root-1')).toBeInTheDocument()

    await user.click(screen.getByTestId('notion-page-preview-root-1'))
    expect(onPreview).toHaveBeenCalledWith(expect.objectContaining({ page_id: 'root-1', workspace_id: 'w1' }))
  })

  it('switches workspace credentials and opens the configuration entry point', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    const onSelectCredential = vi.fn()

    render(
      <NotionPageSelector
        credentialList={credentials}
        onSelect={onSelect}
        onSelectCredential={onSelectCredential}
        datasetId="dataset-1"
      />,
    )

    expect(onSelectCredential).toHaveBeenCalledWith('c1')

    await user.click(screen.getByRole('combobox', { name: /Workspace 1/ }))
    await user.click(screen.getByTestId('notion-credential-item-c2'))

    expect(mockInvalidPreImportNotionPages).toHaveBeenCalledWith({ datasetId: 'dataset-1', credentialId: 'c2' })
    expect(onSelect).toHaveBeenCalledWith([])

    await waitFor(() => {
      expect(onSelectCredential).toHaveBeenLastCalledWith('c2')
      expect(screen.getByTestId('notion-page-name-external-1')).toBeInTheDocument()
    })

    await user.click(screen.getByRole('button', { name: 'common.dataSource.notion.selector.configure' }))
    expect(mockSetShowAccountSettingModal).toHaveBeenCalledWith({ payload: ACCOUNT_SETTING_TAB.DATA_SOURCE })
  })
})
