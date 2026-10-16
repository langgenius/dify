import type { DataSourceCredential } from '../../../header/account-setting/data-source-page-new/types'
import type { DataSourceNotionWorkspace } from '@/models/common'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { CredentialTypeEnum } from '@/app/components/plugins/plugin-auth/types'
import { consoleQuery } from '@/service/console'
import NotionPageSelector from '../base'

vi.mock('@tanstack/react-virtual')

const { usePreImportNotionPages, mockInvalidateQueries } = vi.hoisted(() => ({
  usePreImportNotionPages: vi.fn(),
  mockInvalidateQueries: vi.fn(),
}))

vi.mock('@tanstack/react-query', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-query')>()),
  useQuery: () => usePreImportNotionPages(),
  useQueryClient: () => ({ invalidateQueries: mockInvalidateQueries }),
}))

const mockSetSettingsDestination = vi.fn()
vi.mock('nuqs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('nuqs')>()
  return { ...actual, useQueryState: () => [null, mockSetSettingsDestination] }
})

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
      {
        page_id: 'root-1',
        page_name: 'Root 1',
        parent_id: 'root',
        page_icon: null,
        type: 'page',
        is_bound: false,
      },
      {
        page_id: 'child-1',
        page_name: 'Child 1',
        parent_id: 'root-1',
        page_icon: null,
        type: 'page',
        is_bound: false,
      },
      {
        page_id: 'bound-1',
        page_name: 'Bound 1',
        parent_id: 'root',
        page_icon: null,
        type: 'page',
        is_bound: true,
      },
    ],
  },
  {
    workspace_id: 'w2',
    workspace_icon: '',
    workspace_name: 'Workspace 2',
    pages: [
      {
        page_id: 'external-1',
        page_name: 'External 1',
        parent_id: 'root',
        page_icon: null,
        type: 'page',
        is_bound: false,
      },
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
} = {}) => ({
  // The query selects the normalized workspaces.
  data: notionInfo,
  isFetching,
  isError,
})

describe('NotionPageSelector Base', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should render loading state when pages are being fetched', () => {
    usePreImportNotionPages.mockReturnValue(createPreImportResult({ isFetching: true }))

    render(<NotionPageSelector credentialList={mockCredentialList} onSelect={vi.fn()} />)

    expect(screen.getByTestId('notion-page-selector-loading')).toBeInTheDocument()
  })

  it('should render connector and open settings when fetch fails', async () => {
    usePreImportNotionPages.mockReturnValue(createPreImportResult({ isError: true }))

    const user = userEvent.setup()
    render(<NotionPageSelector credentialList={mockCredentialList} onSelect={vi.fn()} />)

    const connectButton = screen.getByRole('button', { name: 'datasetCreation.stepOne.connect' })
    await user.click(connectButton)

    expect(mockSetSettingsDestination).toHaveBeenCalledWith('data-source')
  })

  it('should render page selector and allow selecting a page tree', async () => {
    usePreImportNotionPages.mockReturnValue(createPreImportResult())

    const handleSelect = vi.fn()
    const user = userEvent.setup()
    render(<NotionPageSelector credentialList={mockCredentialList} onSelect={handleSelect} />)

    expect(screen.getByTestId('notion-page-selector-base')).toBeInTheDocument()
    expect(screen.getByText('Root 1')).toBeInTheDocument()
    expect(screen.getByText('External 1')).toBeInTheDocument()
    const checkbox = screen.getByRole('checkbox', { name: 'Root 1' })
    await user.click(checkbox)

    expect(handleSelect).toHaveBeenCalled()
    expect(handleSelect).toHaveBeenLastCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ page_id: 'root-1', workspace_id: 'w1' }),
        expect.objectContaining({ page_id: 'child-1', workspace_id: 'w1' }),
        expect.objectContaining({ page_id: 'bound-1', workspace_id: 'w1' }),
      ]),
    )
  })

  it('should keep bound pages disabled and selected by default', async () => {
    usePreImportNotionPages.mockReturnValue(createPreImportResult())
    const handleSelect = vi.fn()
    const user = userEvent.setup()
    render(<NotionPageSelector credentialList={mockCredentialList} onSelect={handleSelect} />)

    const boundCheckbox = screen.getByRole('checkbox', { name: 'Bound 1' })
    expect(boundCheckbox).toHaveAttribute('aria-checked', 'true')
    await user.click(boundCheckbox)
    expect(handleSelect).not.toHaveBeenCalled()
  })

  it('should filter and clear search results from search input actions', async () => {
    usePreImportNotionPages.mockReturnValue(createPreImportResult())
    const user = userEvent.setup()
    render(<NotionPageSelector credentialList={mockCredentialList} onSelect={vi.fn()} />)

    const searchInput = screen.getByPlaceholderText('common.dataSource.notion.selector.searchPages')
    await user.type(searchInput, 'no-such-page')
    expect(screen.getByText('common.dataSource.notion.selector.noSearchResult')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'common.operation.clear' }))
    expect(screen.getByText('Root 1')).toBeInTheDocument()
  })

  it('should switch credential and reset selection when choosing a different workspace', async () => {
    usePreImportNotionPages.mockReturnValue(createPreImportResult())
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

    const selectorBtn = screen.getByRole('combobox', { name: /Workspace 1/ })
    await user.click(selectorBtn)
    const item2 = screen.getByRole('option', { name: /Workspace 2/ })
    await user.click(item2)

    expect(mockInvalidateQueries).toHaveBeenCalledWith({
      queryKey: consoleQuery.notion.preImport.pages.get.queryKey({
        input: { query: { dataset_id: 'dataset-1', credential_id: 'c2' } },
      }),
    })
    expect(handleSelect).toHaveBeenCalledWith([])
    expect(onSelectCredential).toHaveBeenLastCalledWith('c2')
  })

  it('should open settings when configuration action in header is clicked', async () => {
    usePreImportNotionPages.mockReturnValue(createPreImportResult())
    const user = userEvent.setup()
    render(<NotionPageSelector credentialList={mockCredentialList} onSelect={vi.fn()} />)

    await user.click(
      screen.getByRole('button', { name: 'common.dataSource.notion.selector.configure' }),
    )
    expect(mockSetSettingsDestination).toHaveBeenCalledWith('data-source')
  })

  it('should preview a page and call onPreview when callback is provided', async () => {
    usePreImportNotionPages.mockReturnValue(createPreImportResult())
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
    expect(onPreview).toHaveBeenCalledWith(
      expect.objectContaining({ page_id: 'root-1', workspace_id: 'w1' }),
    )
  })

  it('should handle preview click without onPreview callback', async () => {
    usePreImportNotionPages.mockReturnValue(createPreImportResult())
    const user = userEvent.setup()
    render(<NotionPageSelector credentialList={mockCredentialList} onSelect={vi.fn()} />)
    await user.click(screen.getByTestId('notion-page-preview-root-1'))
    expect(screen.getByText('Root 1')).toBeInTheDocument()
  })

  it('should call onSelectCredential with current credential on initial render', () => {
    usePreImportNotionPages.mockReturnValue(createPreImportResult())
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
    usePreImportNotionPages.mockReturnValue(createPreImportResult({ isError: true }))
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
      expect(mockInvalidateQueries).toHaveBeenCalledWith({
        queryKey: consoleQuery.notion.preImport.pages.get.queryKey({
          input: { query: { dataset_id: 'dataset-fallback', credential_id: 'c3' } },
        }),
      })
      expect(onSelect).toHaveBeenCalledWith([])
      expect(onSelectCredential).toHaveBeenLastCalledWith('c3')
    })
  })

  it('should update selected page state when controlled value changes', () => {
    usePreImportNotionPages.mockReturnValue(createPreImportResult())
    const { rerender } = render(
      <NotionPageSelector
        credentialList={mockCredentialList}
        onSelect={vi.fn()}
        value={['root-1']}
      />,
    )
    expect(screen.getByRole('checkbox', { name: 'Root 1' })).toHaveAttribute('aria-checked', 'true')

    rerender(
      <NotionPageSelector credentialList={mockCredentialList} onSelect={vi.fn()} value={[]} />,
    )
    expect(screen.getByRole('checkbox', { name: 'Root 1' })).toHaveAttribute(
      'aria-checked',
      'false',
    )
  })

  it('should hide preview actions when canPreview is false', () => {
    usePreImportNotionPages.mockReturnValue(createPreImportResult())
    render(
      <NotionPageSelector
        credentialList={mockCredentialList}
        onSelect={vi.fn()}
        canPreview={false}
      />,
    )
    expect(screen.queryByTestId('notion-page-preview-root-1')).not.toBeInTheDocument()
  })

  it('should handle undefined data gracefully during loading', () => {
    usePreImportNotionPages.mockReturnValue({
      data: undefined,
      isFetching: true,
      isError: false,
    } as ReturnType<typeof usePreImportNotionPages>)
    render(<NotionPageSelector credentialList={mockCredentialList} onSelect={vi.fn()} />)
    expect(screen.getByTestId('notion-page-selector-loading')).toBeInTheDocument()
  })

  it('should handle credential with empty id', () => {
    usePreImportNotionPages.mockReturnValue(createPreImportResult())
    const onSelectCredential = vi.fn()
    render(
      <NotionPageSelector
        credentialList={[buildCredential('', 'Empty', 'Empty Workspace')]}
        onSelect={vi.fn()}
        onSelectCredential={onSelectCredential}
      />,
    )
    expect(onSelectCredential).toHaveBeenCalledWith('')
  })

  it('should render empty page selector when there are no workspaces', () => {
    usePreImportNotionPages.mockReturnValue({
      data: [],
      isFetching: false,
      isError: false,
    } as ReturnType<typeof usePreImportNotionPages>)
    render(<NotionPageSelector credentialList={mockCredentialList} onSelect={vi.fn()} />)
    expect(screen.getByTestId('notion-page-selector-base')).toBeInTheDocument()
  })

  it('should run credential effect fallback when onSelectCredential is not provided', () => {
    usePreImportNotionPages.mockReturnValue(createPreImportResult())
    const { rerender } = render(
      <NotionPageSelector credentialList={mockCredentialList} onSelect={vi.fn()} />,
    )

    // Rerender with a new credentialList but same credential to hit the else block without onSelectCredential
    rerender(
      <NotionPageSelector
        credentialList={[...mockCredentialList, buildCredential('c3', 'Cred 3', 'Workspace 3')]}
        onSelect={vi.fn()}
      />,
    )

    expect(screen.getByTestId('notion-page-selector-base')).toBeInTheDocument()
  })
})
