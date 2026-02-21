import type { DataSourceCredential } from '../../header/account-setting/data-source-page-new/types'
import type { DataSourceNotionWorkspace } from '@/models/common'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ACCOUNT_SETTING_TAB } from '@/app/components/header/account-setting/constants'
import { CredentialTypeEnum } from '@/app/components/plugins/plugin-auth/types'
import { useModalContextSelector } from '@/context/modal-context'
import { useInvalidPreImportNotionPages, usePreImportNotionPages } from '@/service/knowledge/use-import'
import NotionPageSelector from './base'

vi.mock('@/service/knowledge/use-import', () => ({
  usePreImportNotionPages: vi.fn(),
  useInvalidPreImportNotionPages: vi.fn(),
}))

vi.mock('@/context/modal-context', () => ({
  useModalContextSelector: vi.fn(),
}))

const buildCredential = (
  id: string,
  name: string,
  workspaceName: string,
): DataSourceCredential => ({
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

const mockCredentialList: DataSourceCredential[] = [
  buildCredential('c1', 'Cred 1', 'Workspace 1'),
  buildCredential('c2', 'Cred 2', 'Workspace 2'),
]

const mockNotionWorkspaces: DataSourceNotionWorkspace[] = [
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
  {
    workspace_id: 'w2',
    workspace_icon: '',
    workspace_name: 'Workspace 2',
    pages: [
      { page_id: 'external-1', page_name: 'External 1', parent_id: 'root', page_icon: null, type: 'page', is_bound: false },
    ],
  },
]

const createPreImportResult = ({
  notionInfo = mockNotionWorkspaces,
  isFetching = false,
  isError = false,
}: {
  notionInfo?: DataSourceNotionWorkspace[]
  isFetching?: boolean
  isError?: boolean
} = {}) =>
  ({
    data: { notion_info: notionInfo },
    isFetching,
    isError,
  }) as ReturnType<typeof usePreImportNotionPages>

describe('NotionPageSelector Base', () => {
  const mockSetShowAccountSettingModal = vi.fn()
  const mockInvalidPreImportNotionPages = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(useModalContextSelector).mockReturnValue(mockSetShowAccountSettingModal)
    vi.mocked(useInvalidPreImportNotionPages).mockReturnValue(mockInvalidPreImportNotionPages)
  })

  it('should render loading state when pages are being fetched', () => {
    vi.mocked(usePreImportNotionPages).mockReturnValue(createPreImportResult({ isFetching: true }))

    render(<NotionPageSelector credentialList={mockCredentialList} onSelect={vi.fn()} />)

    expect(screen.getByTestId('notion-page-selector-loading')).toBeInTheDocument()
  })

  it('should render connector and open settings when fetch fails', async () => {
    vi.mocked(usePreImportNotionPages).mockReturnValue(createPreImportResult({ isError: true }))

    const user = userEvent.setup()
    render(<NotionPageSelector credentialList={mockCredentialList} onSelect={vi.fn()} />)

    const connectButton = screen.getByRole('button', { name: 'datasetCreation.stepOne.connect' })
    await user.click(connectButton)

    expect(mockSetShowAccountSettingModal).toHaveBeenCalledWith({ payload: ACCOUNT_SETTING_TAB.DATA_SOURCE })
  })

  it('should render page selector and allow selecting a page tree', async () => {
    vi.mocked(usePreImportNotionPages).mockReturnValue(createPreImportResult())

    const handleSelect = vi.fn()
    const user = userEvent.setup()
    render(<NotionPageSelector credentialList={mockCredentialList} onSelect={handleSelect} />)

    expect(screen.getByTestId('notion-page-selector-base')).toBeInTheDocument()
    expect(screen.getByTestId('notion-page-name-root-1')).toBeInTheDocument()
    const checkbox = screen.getByTestId('checkbox-notion-page-checkbox-root-1')
    await user.click(checkbox)

    expect(handleSelect).toHaveBeenCalled()
    expect(handleSelect).toHaveBeenLastCalledWith(expect.arrayContaining([
      expect.objectContaining({ page_id: 'root-1', workspace_id: 'w1' }),
      expect.objectContaining({ page_id: 'child-1', workspace_id: 'w1' }),
      expect.objectContaining({ page_id: 'bound-1', workspace_id: 'w1' }),
    ]))
  })

  it('should keep bound pages disabled and selected by default', async () => {
    vi.mocked(usePreImportNotionPages).mockReturnValue(createPreImportResult())
    const handleSelect = vi.fn()
    const user = userEvent.setup()
    render(<NotionPageSelector credentialList={mockCredentialList} onSelect={handleSelect} />)

    const boundCheckbox = screen.getByTestId('checkbox-notion-page-checkbox-bound-1')
    expect(screen.getByTestId('check-icon-notion-page-checkbox-bound-1')).toBeInTheDocument()
    await user.click(boundCheckbox)
    expect(handleSelect).not.toHaveBeenCalled()
  })

  it('should filter and clear search results from search input actions', async () => {
    vi.mocked(usePreImportNotionPages).mockReturnValue(createPreImportResult())
    const user = userEvent.setup()
    render(<NotionPageSelector credentialList={mockCredentialList} onSelect={vi.fn()} />)

    const searchInput = screen.getByTestId('notion-search-input')
    await user.type(searchInput, 'no-such-page')
    expect(screen.getByText('common.dataSource.notion.selector.noSearchResult')).toBeInTheDocument()

    await user.click(screen.getByTestId('notion-search-input-clear'))
    expect(screen.getByTestId('notion-page-name-root-1')).toBeInTheDocument()
  })

  it('should switch credential and reset selection when choosing a different workspace', async () => {
    vi.mocked(usePreImportNotionPages).mockReturnValue(createPreImportResult())
    const handleSelect = vi.fn()
    const onSelectCredential = vi.fn()
    const user = userEvent.setup()
    render(
      <NotionPageSelector
        credentialList={mockCredentialList}
        onSelect={handleSelect}
        onSelectCredential={onSelectCredential}
        datasetId="dataset-1"
      />,
    )

    const selectorBtn = screen.getByTestId('notion-credential-selector-btn')
    await user.click(selectorBtn)
    const item2 = screen.getByTestId('notion-credential-item-c2')
    await user.click(item2)

    expect(mockInvalidPreImportNotionPages).toHaveBeenCalledWith({ datasetId: 'dataset-1', credentialId: 'c2' })
    expect(handleSelect).toHaveBeenCalledWith([])
    expect(onSelectCredential).toHaveBeenLastCalledWith('c2')
  })

  it('should open settings when configuration action in header is clicked', async () => {
    vi.mocked(usePreImportNotionPages).mockReturnValue(createPreImportResult())
    const user = userEvent.setup()
    render(<NotionPageSelector credentialList={mockCredentialList} onSelect={vi.fn()} />)

    await user.click(screen.getByRole('button', { name: 'Configure Notion' }))
    expect(mockSetShowAccountSettingModal).toHaveBeenCalledWith({ payload: ACCOUNT_SETTING_TAB.DATA_SOURCE })
  })

  it('should preview a page and call onPreview when callback is provided', async () => {
    vi.mocked(usePreImportNotionPages).mockReturnValue(createPreImportResult())
    const onPreview = vi.fn()
    const user = userEvent.setup()
    render(
      <NotionPageSelector
        credentialList={mockCredentialList}
        onSelect={vi.fn()}
        onPreview={onPreview}
        previewPageId="root-1"
      />,
    )

    const previewBtn = screen.getByTestId('notion-page-preview-root-1')
    await user.click(previewBtn)
    expect(onPreview).toHaveBeenCalledWith(expect.objectContaining({ page_id: 'root-1', workspace_id: 'w1' }))
  })

  it('should handle preview click without onPreview callback', async () => {
    vi.mocked(usePreImportNotionPages).mockReturnValue(createPreImportResult())
    const user = userEvent.setup()
    render(<NotionPageSelector credentialList={mockCredentialList} onSelect={vi.fn()} />)
    await user.click(screen.getByTestId('notion-page-preview-root-1'))
    expect(screen.getByTestId('notion-page-name-root-1')).toBeInTheDocument()
  })

  it('should call onSelectCredential with current credential on initial render', () => {
    vi.mocked(usePreImportNotionPages).mockReturnValue(createPreImportResult())
    const onSelectCredential = vi.fn()
    render(
      <NotionPageSelector
        credentialList={mockCredentialList}
        onSelect={vi.fn()}
        onSelectCredential={onSelectCredential}
      />,
    )

    expect(onSelectCredential).toHaveBeenCalledWith('c1')
  })

  it('should fallback to first credential when current credential is removed in error mode', async () => {
    vi.mocked(usePreImportNotionPages).mockReturnValue(createPreImportResult({ isError: true }))
    const onSelect = vi.fn()
    const onSelectCredential = vi.fn()
    const { rerender } = render(
      <NotionPageSelector
        credentialList={mockCredentialList}
        onSelect={onSelect}
        onSelectCredential={onSelectCredential}
        datasetId="dataset-fallback"
      />,
    )

    rerender(
      <NotionPageSelector
        credentialList={[buildCredential('c3', 'Cred 3', 'Workspace 3')]}
        onSelect={onSelect}
        onSelectCredential={onSelectCredential}
        datasetId="dataset-fallback"
      />,
    )

    await waitFor(() => {
      expect(mockInvalidPreImportNotionPages).toHaveBeenCalledWith({ datasetId: 'dataset-fallback', credentialId: 'c3' })
      expect(onSelect).toHaveBeenCalledWith([])
      expect(onSelectCredential).toHaveBeenLastCalledWith('c3')
    })
  })

  it('should update selected page state when controlled value changes', () => {
    vi.mocked(usePreImportNotionPages).mockReturnValue(createPreImportResult())
    const { rerender } = render(
      <NotionPageSelector credentialList={mockCredentialList} onSelect={vi.fn()} value={['root-1']} />,
    )
    expect(screen.getByTestId('check-icon-notion-page-checkbox-root-1')).toBeInTheDocument()

    rerender(<NotionPageSelector credentialList={mockCredentialList} onSelect={vi.fn()} value={[]} />)
    expect(screen.queryByTestId('check-icon-notion-page-checkbox-root-1')).not.toBeInTheDocument()
  })

  it('should hide preview actions when canPreview is false', () => {
    vi.mocked(usePreImportNotionPages).mockReturnValue(createPreImportResult())
    render(<NotionPageSelector credentialList={mockCredentialList} onSelect={vi.fn()} canPreview={false} />)
    expect(screen.queryByTestId('notion-page-preview-root-1')).not.toBeInTheDocument()
  })
})
