import { act, render, screen, waitFor } from '@testing-library/react'
import { AgentPermission } from '@/features/agent-v2/acl'
import useDocumentTitle from '@/hooks/use-document-title'
import { consoleQuery } from '@/service/console'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { createAgentFixture } from '@/test/fixtures/agent'
import { AgentDetailLayout } from '../layout'

const router = vi.hoisted(() => ({ replace: vi.fn() }))
const location = vi.hoisted(() => ({ pathname: '/agents/agent-1/configure' }))
vi.mock('@/next/navigation', () => ({
  usePathname: () => location.pathname,
  useRouter: () => router,
}))
vi.mock('@/hooks/use-document-title', () => ({ default: vi.fn() }))

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
    vi.clearAllMocks()
    location.pathname = '/agents/agent-1/configure'
  })

  it.each(['configure', 'access', 'logs', 'monitoring', 'access-config'])(
    'renders the authorized %s page and its document title',
    (section) => {
      location.pathname = `/agents/agent-1/${section}`
      render(content, setup())
      expect(screen.getByText('Agent detail content')).toBeInTheDocument()
      expect(useDocumentTitle).toHaveBeenLastCalledWith(
        `agentV2.agentDetail.sections.${section} · Agent`,
      )
      expect(screen.queryByRole('complementary')).not.toBeInTheDocument()
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

  it('redirects to the roster when the agent no longer exists', async () => {
    const { wrapper, queryClient } = setup()
    queryClient.setDefaultOptions({ queries: { retry: false, retryOnMount: false } })
    queryClient
      .getQueryCache()
      .find({ queryKey: detailKey })!
      .setState({
        data: undefined,
        error: Object.assign(new Response(null, { status: 404 }), {
          name: 'NotFound',
          message: 'Not found',
        }),
        status: 'error',
        fetchStatus: 'idle',
      })
    render(content, { wrapper })
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/agents'))
    expect(screen.queryByText('Agent detail content')).not.toBeInTheDocument()
  })
})
