import { screen, waitFor } from '@testing-library/react'
import { renderWithConsoleQuery as render } from '@/test/console/query-data'
import { KnowledgeRouteGuard } from '../knowledge-route-guard'

const routerMock = vi.hoisted(() => ({ replace: vi.fn() }))

vi.mock('@/next/navigation', () => ({
  useRouter: () => routerMock,
}))

describe('KnowledgeRouteGuard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders new KnowledgeFS routes while enabled', () => {
    render(
      <KnowledgeRouteGuard>
        <div>protected content</div>
      </KnowledgeRouteGuard>,
      { systemFeatures: { knowledge_fs_enabled: true } },
    )

    expect(screen.getByText('protected content')).toBeInTheDocument()
    expect(routerMock.replace).not.toHaveBeenCalled()
  })

  it('redirects without mounting KnowledgeFS route content while disabled', async () => {
    render(
      <KnowledgeRouteGuard>
        <div>protected content</div>
      </KnowledgeRouteGuard>,
      { systemFeatures: { knowledge_fs_enabled: false } },
    )

    expect(screen.queryByText('protected content')).not.toBeInTheDocument()
    await waitFor(() => expect(routerMock.replace).toHaveBeenCalledWith('/datasets'))
  })
})
