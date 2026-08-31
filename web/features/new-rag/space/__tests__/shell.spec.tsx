import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithConsoleQuery } from '@/test/console/query-data'
import { KnowledgeSpaceShell } from '../shell'

const render = renderWithConsoleQuery

const queryMock = vi.hoisted(() => ({
  data: undefined as
    | {
        control_space_id: string
        permission_keys?: string[]
        state?: 'active' | 'provisioning'
        technical_summary: {
          model_profile?: Record<string, unknown> | null
          name: string
        }
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
  isError: false,
  isPending: false,
}))

vi.mock('@/next/navigation', () => ({
  usePathname: () => pathnameMock.value,
}))

vi.mock('@tanstack/react-query', async (importOriginal) => {
  const original = await importOriginal<typeof import('@tanstack/react-query')>()
  return {
    ...original,
    useQuery: (options: { enabled?: boolean; queryKey?: string[] }) => {
      useQueryOptionsMock(options)
      if (options.queryKey?.[0] === 'external-access')
        return options.enabled
          ? externalAccessQueryMock
          : { data: undefined, isError: false, isPending: false }
      return queryMock
    },
  }
})

vi.mock('@/service/client', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/service/client')>()
  return {
    ...original,
    consoleQuery: {
      ...original.consoleQuery,
      systemFeatures: original.consoleQuery.systemFeatures,
      knowledgeFs: {
        ...original.consoleQuery.knowledgeFs,
        spaces: {
          ...original.consoleQuery.knowledgeFs.spaces,
          byControlSpaceId: {
            ...original.consoleQuery.knowledgeFs.spaces.byControlSpaceId,
            externalAccess: {
              ...original.consoleQuery.knowledgeFs.spaces.byControlSpaceId.externalAccess,
              get: {
                ...original.consoleQuery.knowledgeFs.spaces.byControlSpaceId.externalAccess.get,
                queryOptions: externalAccessQueryOptionsMock,
              },
            },
            get: {
              ...original.consoleQuery.knowledgeFs.spaces.byControlSpaceId.get,
              queryOptions: queryOptionsMock,
            },
          },
        },
      },
    },
  }
})

vi.mock('../api-access-dialog', () => ({
  KnowledgeFsApiAccessDialog: ({
    status,
    open,
  }: {
    status: 'active' | 'inactive' | 'loading' | 'unavailable'
    open: boolean
  }) =>
    open ? (
      <div role="dialog" aria-label="knowledge-fs-api-access">
        {status}
      </div>
    ) : null,
}))

describe('KnowledgeSpaceShell', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    document.title = ''
    queryMock.data = undefined
    queryMock.error = null
    queryMock.isPending = false
    pathnameMock.value = '/datasets/new/space-1/sources'
    externalAccessQueryMock.data.agent_enabled = true
    externalAccessQueryMock.data.service_api_enabled = true
    externalAccessQueryMock.isError = false
    externalAccessQueryMock.isPending = false
  })

  it.each([
    ['/datasets/new/space-1', 'dataset.newKnowledge.overviewTitle'],
    ['/datasets/new/space-1/sources', 'dataset.newKnowledge.sources'],
    ['/datasets/new/space-1/sources/new', 'dataset.newKnowledge.addSource'],
    ['/datasets/new/space-1/documents', 'dataset.newKnowledge.documents'],
    ['/datasets/new/space-1/retrieval', 'dataset.newKnowledge.retrievalTest.title'],
    ['/datasets/new/space-1/quality', 'dataset.newKnowledge.quality'],
    ['/datasets/new/space-1/settings', 'common.datasetMenus.settings'],
  ])('identifies the current detail page for %s', async (pathname, pageTitle) => {
    pathnameMock.value = pathname
    queryMock.data = {
      control_space_id: 'space-1',
      permission_keys: ['knowledge_space_access_config'],
      state: 'active',
      technical_summary: { name: 'Support knowledge' },
    }

    renderWithConsoleQuery(
      <KnowledgeSpaceShell knowledgeSpaceId="space-1">content</KnowledgeSpaceShell>,
    )

    await waitFor(() => {
      expect(document.title).toBe(`${pageTitle} · Support knowledge - Dify`)
    })
  })

  it('delegates a document detail title to the document page', () => {
    pathnameMock.value = '/datasets/new/space-1/documents/document-1'
    queryMock.data = {
      control_space_id: 'space-1',
      state: 'active',
      technical_summary: { name: 'Support knowledge' },
    }

    renderWithConsoleQuery(
      <KnowledgeSpaceShell knowledgeSpaceId="space-1">document content</KnowledgeSpaceShell>,
    )

    expect(document.title).toBe('')
  })

  it('loads the real knowledge space contract by route id', () => {
    queryMock.isPending = true

    renderWithConsoleQuery(
      <KnowledgeSpaceShell knowledgeSpaceId="space-1">content</KnowledgeSpaceShell>,
    )

    expect(queryOptionsMock).toHaveBeenCalledWith({
      input: { params: { control_space_id: 'space-1' } },
      context: { silent: true },
    })
    expect(screen.getByRole('status')).toBeInTheDocument()
  })

  it('renders a refresh-safe header and route navigation when loaded', () => {
    queryMock.data = {
      control_space_id: 'space-1',
      permission_keys: ['knowledge_space_access_config'],
      state: 'active',
      technical_summary: {
        model_profile: {
          pendingModelConfiguration: {
            embeddingSelection: { model: 'openai/text-embedding-3-large' },
            retrievalProfile: { defaultMode: 'fast' },
          },
        },
        name: 'Support knowledge',
      },
    }

    renderWithConsoleQuery(
      <KnowledgeSpaceShell knowledgeSpaceId="space-1">source content</KnowledgeSpaceShell>,
    )

    expect(screen.getByRole('heading', { name: 'Support knowledge' })).toBeInTheDocument()
    expect(
      screen.queryByText('dataset.newKnowledge.settings.retrievalMode.fast'),
    ).not.toBeInTheDocument()
    expect(screen.queryByText('text-embedding-3-large')).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'common.mainNav.home' })).toHaveAttribute('href', '/')
    expect(screen.getByRole('link', { name: 'dataset.knowledge' })).toHaveAttribute(
      'href',
      '/datasets?view=new',
    )
    expect(
      screen.getByRole('link', { name: 'dataset.newKnowledge.overviewTitle' }),
    ).toHaveAttribute('href', '/datasets/new/space-1')
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
      screen.getByRole('link', { name: 'dataset.newKnowledge.retrievalTest.title' }),
    ).toHaveAttribute('href', '/datasets/new/space-1/retrieval')
    expect(screen.getByText('dataset.newKnowledge.apiAccessActive')).toBeInTheDocument()
    expect(screen.getByText('source content')).toBeInTheDocument()
  })

  it('does not report API access as inactive when the user cannot inspect its configuration', () => {
    queryMock.data = {
      control_space_id: 'space-1',
      permission_keys: [],
      state: 'active',
      technical_summary: { name: 'Support knowledge' },
    }

    render(<KnowledgeSpaceShell knowledgeSpaceId="space-1">source content</KnowledgeSpaceShell>)

    expect(screen.getByText('dataset.unavailable')).toBeInTheDocument()
    expect(screen.queryByText('dataset.newKnowledge.apiAccessInactive')).not.toBeInTheDocument()
    expect(useQueryOptionsMock).toHaveBeenCalledWith(
      expect.objectContaining({ enabled: false, queryKey: ['external-access'] }),
    )
  })

  it('keeps all navigation discoverable in a three-column mobile grid', () => {
    queryMock.data = {
      control_space_id: 'space-1',
      state: 'active',
      technical_summary: { name: 'Support knowledge' },
    }

    render(<KnowledgeSpaceShell knowledgeSpaceId="space-1">source content</KnowledgeSpaceShell>)

    const navigation = screen.getByRole('navigation', { name: 'Support knowledge' })
    expect(navigation).toHaveClass('grid', 'grid-cols-3', 'sm:flex', 'sm:flex-col')
    expect(navigation).not.toHaveClass('overflow-x-auto')
    expect(within(navigation).getAllByRole('link')).toHaveLength(6)
    expect(
      within(navigation).getByRole('link', { name: 'common.datasetMenus.settings' }),
    ).toBeInTheDocument()
  })

  it('shows API access as inactive when Service API access is disabled', () => {
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

  it('shows API access as active independently from Agent access', () => {
    queryMock.data = {
      control_space_id: 'space-1',
      permission_keys: ['knowledge_space_access_config'],
      state: 'active',
      technical_summary: { name: 'Support knowledge' },
    }
    externalAccessQueryMock.data.agent_enabled = false

    render(<KnowledgeSpaceShell knowledgeSpaceId="space-1">source content</KnowledgeSpaceShell>)

    expect(screen.getByText('dataset.newKnowledge.apiAccessActive')).toBeInTheDocument()
  })

  it('opens the KnowledgeFS API access dialog', async () => {
    const user = userEvent.setup()
    queryMock.data = {
      control_space_id: 'space-1',
      permission_keys: ['knowledge_space_access_config'],
      state: 'active',
      technical_summary: { name: 'Support knowledge' },
    }

    render(<KnowledgeSpaceShell knowledgeSpaceId="space-1">source content</KnowledgeSpaceShell>)
    await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.apiAgentAccess' }))

    expect(screen.getByRole('dialog', { name: 'knowledge-fs-api-access' })).toHaveTextContent(
      'active',
    )
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

  it('marks the retrieval test as the current navigation item', () => {
    pathnameMock.value = '/datasets/new/space-1/retrieval'
    queryMock.data = {
      control_space_id: 'space-1',
      state: 'active',
      technical_summary: { name: 'Support knowledge' },
    }

    render(<KnowledgeSpaceShell knowledgeSpaceId="space-1">retrieval content</KnowledgeSpaceShell>)

    expect(
      screen.getByRole('link', { name: 'dataset.newKnowledge.retrievalTest.title' }),
    ).toHaveAttribute('aria-current', 'page')
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

    renderWithConsoleQuery(
      <KnowledgeSpaceShell knowledgeSpaceId="missing">source content</KnowledgeSpaceShell>,
    )

    expect(screen.getByText('dataset.newKnowledge.notFoundTitle')).toBeInTheDocument()
    expect(screen.queryByText('source content')).not.toBeInTheDocument()
  })

  it('recognizes the nested status shape returned by the ORPC client', () => {
    queryMock.error = { data: { status: 404 } }

    renderWithConsoleQuery(
      <KnowledgeSpaceShell knowledgeSpaceId="missing">source content</KnowledgeSpaceShell>,
    )

    expect(screen.getByText('dataset.newKnowledge.notFoundTitle')).toBeInTheDocument()
  })

  it('treats forbidden detail responses as a terminal non-disclosing state', () => {
    queryMock.error = { data: { status: 403 } }

    renderWithConsoleQuery(
      <KnowledgeSpaceShell knowledgeSpaceId="private">source content</KnowledgeSpaceShell>,
    )

    expect(screen.getByText('dataset.newKnowledge.notFoundTitle')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'common.operation.retry' })).not.toBeInTheDocument()
  })

  it.each([{ status: 403 }, { data: { status: 404 } }])(
    'does not automatically retry terminal detail errors shaped as $error',
    (error) => {
      queryMock.error = error

      renderWithConsoleQuery(
        <KnowledgeSpaceShell knowledgeSpaceId="private">source content</KnowledgeSpaceShell>,
      )

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

    renderWithConsoleQuery(
      <KnowledgeSpaceShell knowledgeSpaceId="space-1">document content</KnowledgeSpaceShell>,
    )

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

    renderWithConsoleQuery(
      <KnowledgeSpaceShell knowledgeSpaceId="space-1">source content</KnowledgeSpaceShell>,
    )
    await user.click(screen.getByRole('button', { name: 'common.operation.retry' }))

    expect(queryMock.refetch).toHaveBeenCalledOnce()
  })
})
