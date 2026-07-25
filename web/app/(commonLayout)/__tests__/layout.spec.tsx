import type { ReactNode } from 'react'
import { render, screen } from '@testing-library/react'
import { Provider, useAtomValue } from 'jotai'
import { detailSidebarModeAtom } from '@/app/components/detail-sidebar/state'

const mocks = vi.hoisted(() => ({
  getInitialDetailSidebarMode: vi.fn(),
}))

vi.mock('@/app/components/detail-sidebar/server', () => ({
  getInitialDetailSidebarMode: mocks.getInitialDetailSidebarMode,
}))

vi.mock('@/app/components/base/zendesk', () => ({
  default: () => null,
}))

vi.mock('@/app/components/header/maintenance-notice', () => ({
  default: () => null,
}))

vi.mock('@/app/components/main-nav/layout', () => ({
  default: ({ children, detailSidebar }: { children: ReactNode; detailSidebar: ReactNode }) => (
    <>
      {detailSidebar}
      {children}
    </>
  ),
}))

vi.mock('@/app/components/next-route-state', () => ({
  NextRouteStateBridge: ({ children }: { children: ReactNode }) => children,
}))

vi.mock('../global-mounts', () => ({
  CommonLayoutGlobalMounts: () => null,
}))

vi.mock('../providers', () => ({
  ConsoleContextProviders: ({ children }: { children: ReactNode }) => children,
  ConsoleRuntimeProviders: ({ children }: { children: ReactNode }) => children,
}))

function DetailSidebarModeValue() {
  return <aside aria-label="Detail sidebar">{useAtomValue(detailSidebarModeAtom)}</aside>
}

describe('CommonLayout', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('initializes detail sidebar state from the request snapshot', async () => {
    mocks.getInitialDetailSidebarMode.mockResolvedValue('collapse')
    const { default: CommonLayout } = await import('../layout')

    const layout = await CommonLayout({
      children: <main>Content</main>,
      detailSidebar: <DetailSidebarModeValue />,
    })
    render(<Provider>{layout}</Provider>)

    expect(screen.getByRole('complementary', { name: 'Detail sidebar' })).toHaveTextContent(
      'collapse',
    )
    expect(screen.getByRole('main')).toHaveTextContent('Content')
    expect(mocks.getInitialDetailSidebarMode).toHaveBeenCalledOnce()
  })
})
