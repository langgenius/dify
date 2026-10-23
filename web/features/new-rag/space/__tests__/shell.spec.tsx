import type {
  KnowledgeFsExternalAccessResponse,
  KnowledgeFsSpaceDetailResponse,
} from '@dify/contracts/api/console/knowledge-fs/types.gen'
import type { ReactNode } from 'react'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import useDocumentTitle from '@/hooks/use-document-title'
import { createHttpError } from '@/service/http-error'
import { createConsoleQueryClient, renderWithConsoleQuery } from '@/test/console/query-data'
import { createKnowledgeSpaceFixture } from '@/test/knowledge-space'
import { KnowledgeSpaceShell } from '../shell'

const service = vi.hoisted(() => ({
  getExternalAccess: vi.fn<() => Promise<KnowledgeFsExternalAccessResponse>>(),
  getSpace: vi.fn<() => Promise<KnowledgeFsSpaceDetailResponse>>(),
}))
const pathnameMock = vi.hoisted(() => ({ value: '/datasets/new/space-1/sources' }))

vi.mock('@/next/navigation', () => ({
  usePathname: () => pathnameMock.value,
}))

vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'knowledgeFs.spaces.byControlSpaceId.externalAccess.get': service.getExternalAccess,
      'knowledgeFs.spaces.byControlSpaceId.get': service.getSpace,
    }),
  }
})

// The dialog owns endpoint and key management; the shell only decides when and with what status.
vi.mock('../api-access-dialog', () => ({
  KnowledgeFsApiAccessDialog: ({ status, open }: { status: string; open: boolean }) =>
    open ? (
      <div role="dialog" aria-label="knowledge-fs-api-access">
        {status}
      </div>
    ) : null,
}))

const externalAccess = (
  overrides: Partial<KnowledgeFsExternalAccessResponse> = {},
): KnowledgeFsExternalAccessResponse => ({
  agent_enabled: true,
  mcp_enabled: false,
  revision: 1,
  service_api_enabled: true,
  workflow_enabled: false,
  ...overrides,
})

const space = (overrides: Partial<KnowledgeFsSpaceDetailResponse> = {}) =>
  createKnowledgeSpaceFixture({
    permission_keys: ['knowledge_space_access_config'],
    ...overrides,
  })

function renderShell(children: ReactNode = 'source content', knowledgeSpaceId = 'space-1') {
  // The shell retries transient failures itself; keep those retries immediate.
  const queryClient = createConsoleQueryClient()
  queryClient.setDefaultOptions({
    ...queryClient.getDefaultOptions(),
    queries: { ...queryClient.getDefaultOptions().queries, retryDelay: 0 },
  })
  return renderWithConsoleQuery(
    <KnowledgeSpaceShell knowledgeSpaceId={knowledgeSpaceId}>{children}</KnowledgeSpaceShell>,
    { queryClient },
  )
}

describe('KnowledgeSpaceShell', () => {
  beforeEach(() => {
    document.title = ''
    pathnameMock.value = '/datasets/new/space-1/sources'
    service.getSpace.mockResolvedValue(space())
    service.getExternalAccess.mockResolvedValue(externalAccess())
  })

  it.each([
    ['/datasets/new/space-1', 'knowledgeSpace.overviewTitle'],
    ['/datasets/new/space-1/sources', 'knowledgeSpace.sources'],
    ['/datasets/new/space-1/sources/new', 'knowledgeSpace.addSource'],
    ['/datasets/new/space-1/documents', 'knowledgeSpace.documents'],
    ['/datasets/new/space-1/retrieval', 'knowledgeSpace.retrievalTest.title'],
    ['/datasets/new/space-1/quality', 'knowledgeSpace.quality'],
    ['/datasets/new/space-1/settings', 'common.datasetMenus.settings'],
  ])('identifies the current detail page for %s', async (pathname, pageTitle) => {
    pathnameMock.value = pathname

    renderShell()

    await waitFor(() => {
      expect(document.title).toBe(`${pageTitle} · Support knowledge - Dify`)
    })
  })

  it('delegates a document detail title to the document page', async () => {
    pathnameMock.value = '/datasets/new/space-1/documents/document-1'
    function DocumentPage() {
      useDocumentTitle('Refund policy.pdf')
      return <p>document content</p>
    }

    renderShell(<DocumentPage />)

    expect(await screen.findByText('document content')).toBeInTheDocument()
    await waitFor(() => expect(document.title).toBe('Refund policy.pdf - Dify'))
  })

  it('renders the header, breadcrumb, and route navigation once the space loads', async () => {
    renderShell()

    expect(await screen.findByRole('heading', { name: 'Support knowledge' })).toBeInTheDocument()
    expect(service.getSpace).toHaveBeenCalledWith({ params: { control_space_id: 'space-1' } })
    const breadcrumb = screen.getByRole('navigation', { name: 'dataset.knowledge' })
    expect(within(breadcrumb).getAllByRole('listitem')).toHaveLength(2)
    expect(
      within(breadcrumb).getByRole('link', { name: 'navigation.mainNav.home' }),
    ).toHaveAttribute('href', '/')
    expect(within(breadcrumb).getByRole('link', { name: 'dataset.knowledge' })).toHaveAttribute(
      'href',
      '/datasets?view=agent',
    )
    const navigation = screen.getByRole('navigation', { name: 'Support knowledge' })
    expect(
      within(navigation)
        .getAllByRole('link')
        .map((link) => link.getAttribute('href')),
    ).toEqual([
      '/datasets/new/space-1',
      '/datasets/new/space-1/sources',
      '/datasets/new/space-1/documents',
      '/datasets/new/space-1/retrieval',
      '/datasets/new/space-1/quality',
      '/datasets/new/space-1/settings',
    ])
    expect(await screen.findByText('knowledgeSpace.apiAccessActive')).toBeInTheDocument()
    expect(screen.getByText('source content')).toBeInTheDocument()
  })

  it.each([
    ['/datasets/new/space-1/sources', 'knowledgeSpace.sourceColumn'],
    ['/datasets/new/space-1/documents', 'knowledgeSpace.documentColumn'],
    ['/datasets/new/space-1/retrieval', 'knowledgeSpace.retrievalTest.title'],
    ['/datasets/new/space-1/settings', 'common.datasetMenus.settings'],
  ])('marks only the navigation item for %s as current', async (pathname, linkName) => {
    pathnameMock.value = pathname

    renderShell()

    const navigation = await screen.findByRole('navigation', { name: 'Support knowledge' })
    const current = within(navigation)
      .getAllByRole('link')
      .filter((link) => link.getAttribute('aria-current') === 'page')
    expect(current).toEqual([within(navigation).getByRole('link', { name: linkName })])
  })

  it('does not report API access status when the user cannot inspect its configuration', async () => {
    service.getSpace.mockResolvedValue(space({ permission_keys: [] }))

    renderShell()

    expect(await screen.findByText('dataset.unavailable')).toBeInTheDocument()
    expect(screen.queryByText('knowledgeSpace.apiAccessInactive')).not.toBeInTheDocument()
    expect(service.getExternalAccess).not.toHaveBeenCalled()
  })

  it.each([
    ['inactive when Service API access is disabled', { service_api_enabled: false }, 'Inactive'],
    ['active independently from Agent access', { agent_enabled: false }, 'Active'],
  ] as const)('shows API access as %s', async (_, access, status) => {
    service.getExternalAccess.mockResolvedValue(externalAccess(access))

    renderShell()

    expect(await screen.findByText(`knowledgeSpace.apiAccess${status}`)).toBeInTheDocument()
  })

  it('opens the KnowledgeFS API access dialog with the loaded status', async () => {
    const user = userEvent.setup()
    renderShell()

    await screen.findByText('knowledgeSpace.apiAccessActive')
    await user.click(screen.getByRole('button', { name: 'knowledgeSpace.apiAgentAccess' }))

    expect(screen.getByRole('dialog', { name: 'knowledge-fs-api-access' })).toHaveTextContent(
      'active',
    )
  })

  it('lets users collapse and restore the knowledge detail sidebar', async () => {
    const user = userEvent.setup()
    renderShell()

    expect(await screen.findByRole('navigation', { name: 'dataset.knowledge' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'layout.sidebar.collapseSidebar' }))
    expect(screen.queryByRole('navigation', { name: 'dataset.knowledge' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'layout.sidebar.expandSidebar' }))
    expect(screen.getByRole('navigation', { name: 'dataset.knowledge' })).toBeInTheDocument()
  })

  it('waits for a provisioning space before mounting data-plane children', async () => {
    service.getSpace
      .mockResolvedValueOnce(space({ state: 'provisioning' }))
      .mockResolvedValue(space())

    renderShell()

    expect(await screen.findByRole('progressbar')).toBeInTheDocument()
    expect(screen.queryByText('source content')).not.toBeInTheDocument()
    expect(await screen.findByText('source content', {}, { timeout: 2500 })).toBeInTheDocument()
    expect(service.getSpace).toHaveBeenCalledTimes(2)
  })

  it.each([403, 404])(
    'shows a terminal not-found state for a %i response without retrying',
    async (status) => {
      service.getSpace.mockRejectedValue(createHttpError(new Response(null, { status })))

      renderShell('source content', 'private')

      expect(await screen.findByText('knowledgeSpace.notFoundTitle')).toBeInTheDocument()
      expect(screen.queryByText('source content')).not.toBeInTheDocument()
      expect(
        screen.queryByRole('button', { name: 'common.operation.retry' }),
      ).not.toBeInTheDocument()
      expect(service.getSpace).toHaveBeenCalledOnce()
    },
  )

  it('offers a retry after transient loading errors are exhausted', async () => {
    const user = userEvent.setup()
    service.getSpace.mockRejectedValue(new Error('temporary failure'))

    renderShell()
    const retry = await screen.findByRole('button', { name: 'common.operation.retry' })
    expect(service.getSpace).toHaveBeenCalledTimes(4)

    service.getSpace.mockResolvedValue(space())
    await user.click(retry)

    expect(await screen.findByText('source content')).toBeInTheDocument()
  })
})
