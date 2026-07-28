import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render } from '@/test/console/render'
import { KnowledgeSpaceShell } from '../knowledge-space-shell'

const queryMock = vi.hoisted(() => ({
  data: undefined as
    | {
        control_space_id: string
        permission_keys?: string[]
        state?: 'active' | 'provisioning'
        technical_summary: { name: string }
      }
    | undefined,
  error: null as unknown,
  isPending: false,
  refetch: vi.fn(),
}))

const queryOptionsMock = vi.hoisted(() => vi.fn(() => ({})))
const externalAccessQueryOptionsMock = vi.hoisted(() =>
  vi.fn(() => ({ queryKey: ['external-access'] })),
)
const useQueryOptionsMock = vi.hoisted(() => vi.fn())
const pathnameMock = vi.hoisted(() => ({ value: '/datasets/new/space-1/sources' }))
const externalAccessQueryMock = vi.hoisted(() => ({
  data: {
    agent_enabled: true,
    mcp_enabled: false,
    revision: 1,
    service_api_enabled: true,
    workflow_enabled: false,
  },
}))

vi.mock('@/next/navigation', () => ({
  usePathname: () => pathnameMock.value,
}))

vi.mock('@tanstack/react-query', async (importOriginal) => {
  const original = await importOriginal<typeof import('@tanstack/react-query')>()
  return {
    ...original,
    useQuery: (options: { queryKey?: string[] }) => {
      useQueryOptionsMock(options)
      if (options.queryKey?.[0] === 'external-access') return externalAccessQueryMock
      return queryMock
    },
  }
})

vi.mock('@/service/client', () => ({
  consoleQuery: {
    knowledgeFs: {
      spaces: {
        byControlSpaceId: {
          externalAccess: {
            get: {
              queryOptions: externalAccessQueryOptionsMock,
            },
          },
          get: {
            queryOptions: queryOptionsMock,
          },
        },
      },
    },
  },
}))

vi.mock('@/hooks/use-document-title', () => ({ default: vi.fn() }))

describe('KnowledgeSpaceShell', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    queryMock.data = undefined
    queryMock.error = null
    queryMock.isPending = false
    pathnameMock.value = '/datasets/new/space-1/sources'
    externalAccessQueryMock.data.agent_enabled = true
    externalAccessQueryMock.data.service_api_enabled = true
  })

  it('loads the real knowledge space contract by route id', () => {
    queryMock.isPending = true

    render(<KnowledgeSpaceShell knowledgeSpaceId="space-1">content</KnowledgeSpaceShell>)

    expect(queryOptionsMock).toHaveBeenCalledWith({
      input: { params: { control_space_id: 'space-1' } },
    })
    expect(screen.getByRole('status')).toBeInTheDocument()
  })

  it('renders a refresh-safe header and route navigation when loaded', () => {
    queryMock.data = {
      control_space_id: 'space-1',
      state: 'active',
      technical_summary: { name: 'Support knowledge' },
    }

    render(<KnowledgeSpaceShell knowledgeSpaceId="space-1">source content</KnowledgeSpaceShell>)

    expect(screen.getByRole('heading', { name: 'Support knowledge' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'dataset.newKnowledge.sourceColumn' })).toHaveAttribute(
      'href',
      '/datasets/new/space-1/sources',
    )
    expect(screen.getByRole('link', { name: 'dataset.newKnowledge.sourceColumn' })).toHaveAttribute(
      'aria-current',
      'page',
    )
    expect(
      screen.getByRole('link', { name: 'dataset.newKnowledge.documentColumn' }),
    ).toHaveAttribute('href', '/datasets/new/space-1/documents')
    expect(screen.getByRole('link', { name: 'common.datasetMenus.settings' })).toHaveAttribute(
      'href',
      '/datasets/new/space-1/settings',
    )
    expect(
      screen.getByRole('button', { name: 'dataset.newKnowledge.evidence' }),
    ).toBeInTheDocument()
    expect(screen.getByText('dataset.newKnowledge.apiAccessActive')).toBeInTheDocument()
    expect(screen.getByText('source content')).toBeInTheDocument()
  })

  it('shows API access as inactive when either public channel is disabled', () => {
    queryMock.data = {
      control_space_id: 'space-1',
      permission_keys: ['knowledge_space_access_config'],
      state: 'active',
      technical_summary: { name: 'Support knowledge' },
    }
    externalAccessQueryMock.data.service_api_enabled = false

    render(<KnowledgeSpaceShell knowledgeSpaceId="space-1">source content</KnowledgeSpaceShell>)

    expect(screen.getByText('dataset.newKnowledge.apiAccessInactive')).toBeInTheDocument()
  })

  it('marks settings as the current navigation item', () => {
    pathnameMock.value = '/datasets/new/space-1/settings'
    queryMock.data = {
      control_space_id: 'space-1',
      state: 'active',
      technical_summary: { name: 'Support knowledge' },
    }

    render(<KnowledgeSpaceShell knowledgeSpaceId="space-1">settings content</KnowledgeSpaceShell>)

    expect(screen.getByRole('link', { name: 'common.datasetMenus.settings' })).toHaveAttribute(
      'aria-current',
      'page',
    )
  })

  it('lets users collapse and restore the knowledge detail sidebar', async () => {
    const user = userEvent.setup()
    queryMock.data = {
      control_space_id: 'space-1',
      state: 'active',
      technical_summary: { name: 'Support knowledge' },
    }

    render(<KnowledgeSpaceShell knowledgeSpaceId="space-1">source content</KnowledgeSpaceShell>)

    await user.click(screen.getByRole('button', { name: 'layout.sidebar.collapseSidebar' }))
    expect(screen.getByRole('button', { name: 'layout.sidebar.expandSidebar' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'layout.sidebar.expandSidebar' }))
    expect(
      screen.getByRole('button', { name: 'layout.sidebar.collapseSidebar' }),
    ).toBeInTheDocument()
  })

  it('polls provisioning spaces without mounting data-plane children', () => {
    queryMock.data = {
      control_space_id: 'space-1',
      state: 'provisioning',
      technical_summary: { name: 'Support knowledge' },
    }

    render(<KnowledgeSpaceShell knowledgeSpaceId="space-1">source content</KnowledgeSpaceShell>)

    expect(screen.getByRole('status')).toBeInTheDocument()
    expect(screen.queryByText('source content')).not.toBeInTheDocument()

    const options = useQueryOptionsMock.mock.calls[0]?.[0] as {
      refetchInterval: (query: {
        state: { data?: { state?: 'active' | 'provisioning' } }
      }) => false | number
    }
    expect(options.refetchInterval({ state: { data: queryMock.data } })).toBe(1000)
    expect(options.refetchInterval({ state: { data: { state: 'active' } } })).toBe(false)
  })

  it('shows a not-found state without rendering children', () => {
    queryMock.error = { status: 404 }

    render(<KnowledgeSpaceShell knowledgeSpaceId="missing">source content</KnowledgeSpaceShell>)

    expect(screen.getByText('dataset.newKnowledge.notFoundTitle')).toBeInTheDocument()
    expect(screen.queryByText('source content')).not.toBeInTheDocument()
  })

  it('recognizes the nested status shape returned by the ORPC client', () => {
    queryMock.error = { data: { status: 404 } }

    render(<KnowledgeSpaceShell knowledgeSpaceId="missing">source content</KnowledgeSpaceShell>)

    expect(screen.getByText('dataset.newKnowledge.notFoundTitle')).toBeInTheDocument()
  })

  it('treats forbidden detail responses as a terminal non-disclosing state', () => {
    queryMock.error = { data: { status: 403 } }

    render(<KnowledgeSpaceShell knowledgeSpaceId="private">source content</KnowledgeSpaceShell>)

    expect(screen.getByText('dataset.newKnowledge.notFoundTitle')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'common.operation.retry' })).not.toBeInTheDocument()
  })

  it.each([{ status: 403 }, { data: { status: 404 } }])(
    'does not automatically retry terminal detail errors shaped as $error',
    (error) => {
      queryMock.error = error

      render(<KnowledgeSpaceShell knowledgeSpaceId="private">source content</KnowledgeSpaceShell>)

      const options = useQueryOptionsMock.mock.calls[0]?.[0] as {
        retry: (failureCount: number, queryError: unknown) => boolean
      }
      expect(options.retry(0, error)).toBe(false)
      expect(options.retry(2, new Error('temporary failure'))).toBe(true)
      expect(options.retry(3, new Error('temporary failure'))).toBe(false)
    },
  )

  it('marks Documents as the only current detail route', () => {
    pathnameMock.value = '/datasets/new/space-1/documents'
    queryMock.data = {
      control_space_id: 'space-1',
      technical_summary: { name: 'Support knowledge' },
    }

    render(<KnowledgeSpaceShell knowledgeSpaceId="space-1">document content</KnowledgeSpaceShell>)

    expect(
      screen.getByRole('link', { name: 'dataset.newKnowledge.sourceColumn' }),
    ).not.toHaveAttribute('aria-current')
    expect(
      screen.getByRole('link', { name: 'dataset.newKnowledge.documentColumn' }),
    ).toHaveAttribute('aria-current', 'page')
  })

  it('offers a real retry for recoverable loading errors', async () => {
    const user = userEvent.setup()
    queryMock.error = new Error('temporary failure')

    render(<KnowledgeSpaceShell knowledgeSpaceId="space-1">source content</KnowledgeSpaceShell>)
    await user.click(screen.getByRole('button', { name: 'common.operation.retry' }))

    expect(queryMock.refetch).toHaveBeenCalledOnce()
  })
})
