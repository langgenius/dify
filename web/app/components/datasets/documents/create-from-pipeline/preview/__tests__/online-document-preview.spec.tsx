import type { NotionPage } from '@/models/common'
import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import * as React from 'react'
import { renderWithConsoleQuery as render } from '@/test/console/query-data'
import { createDeferred } from '@/test/deferred'
import OnlineDocumentPreview from '../online-document-preview'

// Uses global react-i18next mock from web/vitest.setup.ts

const { mockToastError } = vi.hoisted(() => ({
  mockToastError: vi.fn(),
}))

vi.mock('@/app/notifications', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/app/notifications')>()
  return {
    ...actual,
    toast: {
      ...actual.toast,
      error: mockToastError,
    },
  }
})

// Mock dataset-detail context - needs mock to control return values
const mockPipelineId = vi.fn()
vi.mock('@/context/dataset-detail', () => ({
  useDatasetDetailContextWithSelector: (
    _selector: (s: { dataset: { pipeline_id: string } }) => string,
  ) => {
    return mockPipelineId()
  },
}))

// Mock usePreviewOnlineDocument hook - needs mock to control mutation behavior
const mockMutateAsync = vi.fn()
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'rag.pipelines.byPipelineId.workflows.published.datasource.nodes.byNodeId.preview.post': (
        input: unknown,
      ) => mockMutateAsync(input),
    }),
  }
})

// Mock data source store - needs mock to control store state
const mockCurrentCredentialId = 'credential-123'
const mockGetState = vi.fn(() => ({
  currentCredentialId: mockCurrentCredentialId,
}))
vi.mock('../../data-source/store', () => ({
  useDataSourceStore: () => ({
    getState: mockGetState,
  }),
}))

// Test data factory
const createMockNotionPage = (overrides?: Partial<NotionPage>): NotionPage => ({
  page_id: 'page-123',
  page_name: 'Test Notion Page',
  workspace_id: 'workspace-456',
  type: 'page',
  page_icon: null,
  parent_id: 'parent-789',
  is_bound: true,
  ...overrides,
})

const defaultProps = {
  currentPage: createMockNotionPage(),
  datasourceNodeId: 'datasource-node-123',
  hidePreview: vi.fn(),
}

describe('OnlineDocumentPreview', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockPipelineId.mockReturnValue('pipeline-123')
    mockGetState.mockReturnValue({ currentCredentialId: mockCurrentCredentialId })
    mockMutateAsync.mockReset().mockResolvedValue({ content: 'Test content' })
  })

  it('requests the current page using the pipeline, node, workspace and credential', async () => {
    mockGetState.mockReturnValue({ currentCredentialId: 'custom-credential' })
    render(<OnlineDocumentPreview {...defaultProps} />)
    expect(await screen.findByText('Test content')).toBeInTheDocument()
    expect(screen.getByText('Test Notion Page')).toBeInTheDocument()
    expect(screen.getByText('page')).toBeInTheDocument()
    expect(mockMutateAsync).toHaveBeenCalledWith({
      params: { pipeline_id: 'pipeline-123', node_id: 'datasource-node-123' },
      body: {
        datasource_type: 'online_document',
        credential_id: 'custom-credential',
        inputs: { workspace_id: 'workspace-456', page_id: 'page-123', type: 'page' },
      },
    })
  })

  it('keeps content hidden until the request resolves and shows its character count', async () => {
    const request = createDeferred<{ content: string }>()
    mockMutateAsync.mockReturnValue(request.promise)
    render(<OnlineDocumentPreview {...defaultProps} />)
    await waitFor(() => expect(mockMutateAsync).toHaveBeenCalledOnce())
    expect(screen.queryByText('Hello')).not.toBeInTheDocument()
    await act(async () => request.resolve({ content: 'Hello' }))
    expect(await screen.findByText('Hello')).toBeInTheDocument()
    expect(screen.getByText('5 datasetPipeline.addDocuments.characters')).toBeInTheDocument()
  })

  it('loads the newly selected page without reusing the previous response', async () => {
    const user = userEvent.setup()
    const { rerender } = render(<OnlineDocumentPreview {...defaultProps} />)
    await screen.findByText('Test content')
    mockMutateAsync.mockResolvedValue({ content: 'New page content' })
    rerender(
      <OnlineDocumentPreview
        {...defaultProps}
        currentPage={createMockNotionPage({ page_id: 'page-2', type: 'database' })}
      />,
    )
    expect(await screen.findByText('New page content')).toBeInTheDocument()
    expect(screen.queryByText('Test content')).not.toBeInTheDocument()
    expect(mockMutateAsync).toHaveBeenCalledTimes(2)
    expect(mockMutateAsync).toHaveBeenLastCalledWith(
      expect.objectContaining({
        body: expect.objectContaining({
          inputs: expect.objectContaining({ page_id: 'page-2', type: 'database' }),
        }),
      }),
    )
    await user.click(screen.getByRole('button'))
    expect(defaultProps.hidePreview).toHaveBeenCalledOnce()
  })

  it('reports a rejected preview request', async () => {
    mockMutateAsync.mockRejectedValue(new Error('Failed to fetch document'))
    render(<OnlineDocumentPreview {...defaultProps} />)
    await waitFor(() => expect(mockToastError).toHaveBeenCalledWith('Failed to fetch document'))
    expect(screen.queryByText('Test content')).not.toBeInTheDocument()
  })

  it('keeps the empty response empty after the mutation finishes', async () => {
    mockMutateAsync.mockResolvedValue({ content: '' })
    const { queryClient } = render(<OnlineDocumentPreview {...defaultProps} />)
    await waitFor(() => expect(mockMutateAsync).toHaveBeenCalledOnce())
    await waitFor(() => expect(queryClient.isMutating()).toBe(0))
    expect(screen.getByText('0 datasetPipeline.addDocuments.characters')).toBeInTheDocument()
    expect(screen.queryByText('Test content')).not.toBeInTheDocument()
  })
})
