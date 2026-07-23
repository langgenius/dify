import { screen, waitFor } from '@testing-library/react'
import { render } from '@/test/console/render'
import { KnowledgeRouteGuard } from '../knowledge-route-guard'

const featureMock = vi.hoisted(() => ({
  enabled: true,
  atom: Symbol('systemFeaturesAtom'),
}))

const routerMock = vi.hoisted(() => ({ replace: vi.fn() }))

vi.mock('@/next/navigation', () => ({
  useRouter: () => routerMock,
}))

vi.mock('@/context/system-features-state', () => ({
  systemFeaturesAtom: featureMock.atom,
}))

vi.mock('jotai', async (importOriginal) => {
  const original = await importOriginal<typeof import('jotai')>()
  return {
    ...original,
    useAtomValue: (atom: unknown) =>
      atom === featureMock.atom
        ? { knowledge_fs_enabled: featureMock.enabled }
        : original.useAtomValue(atom as Parameters<typeof original.useAtomValue>[0]),
  }
})

describe('KnowledgeRouteGuard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    featureMock.enabled = true
  })

  it('renders new KnowledgeFS routes while enabled', () => {
    render(
      <KnowledgeRouteGuard>
        <div>protected content</div>
      </KnowledgeRouteGuard>,
    )

    expect(screen.getByText('protected content')).toBeInTheDocument()
    expect(routerMock.replace).not.toHaveBeenCalled()
  })

  it('redirects without mounting KnowledgeFS route content while disabled', async () => {
    featureMock.enabled = false

    render(
      <KnowledgeRouteGuard>
        <div>protected content</div>
      </KnowledgeRouteGuard>,
    )

    expect(screen.queryByText('protected content')).not.toBeInTheDocument()
    await waitFor(() => expect(routerMock.replace).toHaveBeenCalledWith('/datasets'))
  })
})
