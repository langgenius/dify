import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AgentPermission } from '@/features/agent-v2/acl'
import { consoleQuery } from '@/service/console'
import { createHttpError } from '@/service/http-error'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { createAgentFixture } from '@/test/fixtures/agent'
import { AgentDetailLayout } from '../layout'

const router = vi.hoisted(() => ({ replace: vi.fn() }))
const location = vi.hoisted(() => ({ pathname: '/agents/agent-1/configure' }))
vi.mock('@/next/navigation', () => ({
  usePathname: () => location.pathname,
  useRouter: () => router,
}))

const detailRequest = vi.hoisted(() => vi.fn())
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'agent.byAgentId.get': detailRequest,
    }),
  }
})

const detailKey = consoleQuery.agent.byAgentId.get.queryKey({
  input: { params: { agent_id: 'agent-1' } },
})

function setup(permissionKeys = createAgentFixture().permission_keys, rbacEnabled = true) {
  const { wrapper, queryClient } = createConsoleQueryWrapper({
    systemFeatures: { rbac_enabled: rbacEnabled },
  })
  queryClient.setQueryData(detailKey, createAgentFixture({ permission_keys: permissionKeys }))
  return { wrapper, queryClient }
}

const content = (
  <AgentDetailLayout agentId="agent-1">
    <div>Agent detail content</div>
  </AgentDetailLayout>
)

describe('AgentDetailLayout', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    location.pathname = '/agents/agent-1/configure'
  })

  it.each(['configure', 'access', 'logs', 'monitoring', 'access-config'])(
    'renders the authorized %s page and its document title',
    (section) => {
      location.pathname = `/agents/agent-1/${section}`
      render(content, setup())
      expect(screen.getByText('Agent detail content')).toBeInTheDocument()
      expect(document.title).toContain(`agentV2.agentDetail.sections.${section} · Agent`)
    },
  )

  it.each(['configure', 'logs', 'monitoring', 'access-config'])(
    'blocks direct navigation to %s for a viewer',
    async (section) => {
      location.pathname = `/agents/agent-1/${section}`
      render(content, setup([AgentPermission.Preview, AgentPermission.AccessPointView]))
      expect(screen.queryByText('Agent detail content')).not.toBeInTheDocument()
      await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/agents/agent-1/access'))
    },
  )

  it('unmounts protected content when resource permissions are revoked', async () => {
    const { wrapper, queryClient } = setup()
    render(content, { wrapper })
    act(() => {
      queryClient.setQueryData(detailKey, createAgentFixture({ permission_keys: [] }))
    })
    await waitFor(() => expect(screen.queryByText('Agent detail content')).not.toBeInTheDocument())
    expect(router.replace).toHaveBeenCalledWith('/agents')
  })

  it('hides ACL management when RBAC is disabled', async () => {
    location.pathname = '/agents/agent-1/access-config'
    render(content, setup(undefined, false))
    expect(screen.queryByText('Agent detail content')).not.toBeInTheDocument()
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/agents/agent-1/configure'))
  })

  it('retries a failed access page request at the detail boundary', async () => {
    const user = userEvent.setup()
    location.pathname = '/agents/agent-1/access'
    const { wrapper, queryClient } = setup()
    queryClient.removeQueries({ queryKey: detailKey })
    queryClient.setDefaultOptions({ queries: { retryDelay: 0 } })
    detailRequest.mockRejectedValue(new Error('Unavailable'))
    render(content, { wrapper })
    expect(await screen.findByRole('alert')).toHaveTextContent('agentRoster.roster.loadingError')
    expect(screen.queryByText('Agent detail content')).not.toBeInTheDocument()
    detailRequest.mockResolvedValue(createAgentFixture())
    await user.click(screen.getByRole('button', { name: 'common.operation.retry' }))
    expect(await screen.findByText('Agent detail content')).toBeVisible()
    expect(detailRequest).toHaveBeenCalledTimes(5)
    expect(detailRequest).toHaveBeenLastCalledWith({ params: { agent_id: 'agent-1' } })
    expect(router.replace).not.toHaveBeenCalled()
  })

  it('redirects a missing agent to the roster', async () => {
    const { wrapper, queryClient } = setup()
    queryClient.removeQueries({ queryKey: detailKey })
    detailRequest.mockRejectedValueOnce(createHttpError(new Response(null, { status: 404 })))
    render(content, { wrapper })
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/agents'))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.queryByText('Agent detail content')).not.toBeInTheDocument()
  })
})
