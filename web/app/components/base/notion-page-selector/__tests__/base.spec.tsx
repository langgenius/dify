import type { DatasourceCredentialResponse } from '@dify/contracts/api/console/auth/types.gen'
import type { ComponentProps, ReactElement } from 'react'
import type { DataSourceNotionWorkspace } from '@/models/common'
import { zNotionIntegrateInfoListResponse } from '@dify/contracts/api/console/notion/zod.gen'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { CredentialTypeEnum } from '@/app/components/plugins/plugin-auth/types'
import { consoleQuery } from '@/service/console'
import { createConsoleQueryClient, renderWithConsoleQuery } from '@/test/console/query-data'
import { createNuqsTestRenderer } from '@/test/nuqs-testing'
import NotionPageSelector from '../base'

vi.mock('@tanstack/react-virtual')

const { fetchPages } = vi.hoisted(() => ({ fetchPages: vi.fn() }))
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'notion.preImport.pages.get': fetchPages,
    }),
  }
})

const buildCredential = (
  id: string,
  name: string,
  workspaceName: string,
): DatasourceCredentialResponse => ({
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

const mockCredentialList: DatasourceCredentialResponse[] = [
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

let seedPages = true
const response = () => ({
  notion_info: mockNotionWorkspaces.map((workspace) => ({
    ...workspace,
    pages: workspace.pages.map((page) => ({
      ...page,
      parent_id: page.parent_id === 'root' ? null : page.parent_id,
    })),
  })),
})
const onUrlUpdate = vi.fn()
const renderWithUrlState = createNuqsTestRenderer(renderWithConsoleQuery, () => ({ onUrlUpdate }))
function render(ui: ReactElement<ComponentProps<typeof NotionPageSelector>>) {
  const queryClient = createConsoleQueryClient()
  if (seedPages)
    queryClient.setQueryData(
      consoleQuery.notion.preImport.pages.get.queryKey({
        input: {
          query: {
            dataset_id: ui.props.datasetId ?? '',
            credential_id: ui.props.credentialList[0]?.id ?? '',
          },
        },
      }),
      zNotionIntegrateInfoListResponse.parse(response()),
    )
  return renderWithUrlState(ui, { queryClient })
}

describe('NotionPageSelector Base', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    seedPages = true
    fetchPages.mockResolvedValue(response())
  })

  it('should render loading state when pages are being fetched', () => {
    seedPages = false
    fetchPages.mockImplementation(() => new Promise(() => {}))

    render(<NotionPageSelector credentialList={mockCredentialList} onSelect={vi.fn()} />)

    expect(screen.getByTestId('notion-page-selector-loading')).toBeInTheDocument()
  })

  it('should render connector and open settings when fetch fails', async () => {
    seedPages = false
    fetchPages.mockRejectedValue(new Error('Notion unavailable'))

    const user = userEvent.setup()
    render(<NotionPageSelector credentialList={mockCredentialList} onSelect={vi.fn()} />)

    const connectButton = await screen.findByRole('button', {
      name: 'datasetCreation.stepOne.connect',
    })
    await user.click(connectButton)

    await waitFor(() =>
      expect(onUrlUpdate.mock.lastCall?.[0].searchParams.get('settings')).toBe('data-source'),
    )
  })

  it('should render page selector and allow selecting a page tree', async () => {
    const handleSelect = vi.fn()
    const user = userEvent.setup()
    render(<NotionPageSelector credentialList={mockCredentialList} onSelect={handleSelect} />)

    expect(screen.getByText('Root 1')).toBeInTheDocument()
    expect(screen.getByText('External 1')).toBeInTheDocument()
    const checkbox = screen.getByRole('checkbox', { name: 'Root 1' })
    await user.click(checkbox)

    expect(handleSelect).toHaveBeenLastCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ page_id: 'root-1', workspace_id: 'w1' }),
        expect.objectContaining({ page_id: 'child-1', workspace_id: 'w1' }),
        expect.objectContaining({ page_id: 'bound-1', workspace_id: 'w1' }),
      ]),
    )
  })

  it('should keep bound pages disabled and selected by default', async () => {
    const handleSelect = vi.fn()
    const user = userEvent.setup()
    render(<NotionPageSelector credentialList={mockCredentialList} onSelect={handleSelect} />)

    const boundCheckbox = screen.getByRole('checkbox', { name: 'Bound 1' })
    expect(boundCheckbox).toHaveAttribute('aria-checked', 'true')
    await user.click(boundCheckbox)
    expect(handleSelect).not.toHaveBeenCalled()
  })

  it('should filter and clear search results from search input actions', async () => {
    const user = userEvent.setup()
    render(<NotionPageSelector credentialList={mockCredentialList} onSelect={vi.fn()} />)

    const searchInput = screen.getByPlaceholderText('common.dataSource.notion.selector.searchPages')
    await user.type(searchInput, 'no-such-page')
    expect(screen.getByText('common.dataSource.notion.selector.noSearchResult')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'common.operation.clear' }))
    expect(screen.getByText('Root 1')).toBeInTheDocument()
  })

  it('should switch credential and reset selection when choosing a different workspace', async () => {
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

    await waitFor(() =>
      expect(fetchPages).toHaveBeenCalledWith({
        query: { dataset_id: 'dataset-1', credential_id: 'c2' },
      }),
    )
    expect(handleSelect).toHaveBeenCalledWith([])
    expect(onSelectCredential).toHaveBeenLastCalledWith('c2')
  })

  it('should open settings when configuration action in header is clicked', async () => {
    const user = userEvent.setup()
    render(<NotionPageSelector credentialList={mockCredentialList} onSelect={vi.fn()} />)

    await user.click(
      screen.getByRole('button', { name: 'common.dataSource.notion.selector.configure' }),
    )
    await waitFor(() =>
      expect(onUrlUpdate.mock.lastCall?.[0].searchParams.get('settings')).toBe('data-source'),
    )
  })

  it('should preview a page and call onPreview when callback is provided', async () => {
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

  it('should fallback to first credential when current credential is removed in error mode', async () => {
    seedPages = false
    fetchPages.mockRejectedValue(new Error('Notion unavailable'))
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
      expect(fetchPages).toHaveBeenCalledWith({
        query: { dataset_id: 'dataset-fallback', credential_id: 'c3' },
      })
      expect(onSelect).toHaveBeenCalledWith([])
      expect(onSelectCredential).toHaveBeenLastCalledWith('c3')
    })
  })

  it('should update selected page state when controlled value changes', () => {
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
    render(
      <NotionPageSelector
        credentialList={mockCredentialList}
        onSelect={vi.fn()}
        canPreview={false}
      />,
    )
    expect(screen.queryByTestId('notion-page-preview-root-1')).not.toBeInTheDocument()
  })
})
