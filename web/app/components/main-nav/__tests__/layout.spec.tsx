import type { ReactNode } from 'react'
import type { Mock } from 'vitest'
import { useSuspenseQuery } from '@tanstack/react-query'
import { fireEvent, render, screen } from '@testing-library/react'
import { useStore as useAppStore } from '@/app/components/app/store'
import { useAppContext } from '@/context/app-context'
import { isAgentV2Enabled } from '@/features/agent-v2/feature-flag'
import { usePathname } from '@/next/navigation'
import MainNavLayout from '../layout'
import { MAIN_CONTENT_ID } from '../skip-nav'

vi.mock('@/app/components/header', () => ({
  default: () => <div data-testid="desktop-header">Header</div>,
}))

vi.mock('@/app/components/header/header-wrapper', () => ({
  default: ({ children }: { children: ReactNode }) => <div data-testid="header-wrapper">{children}</div>,
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}))

vi.mock('@tanstack/react-query', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-query')>()
  return {
    ...actual,
    useSuspenseQuery: vi.fn(),
  }
})

vi.mock('@/context/app-context', () => ({
  useAppContext: vi.fn(),
}))

vi.mock('@/features/agent-v2/feature-flag', () => ({
  isAgentV2Enabled: vi.fn(),
}))

vi.mock('@/next/navigation', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/next/navigation')>()
  return {
    ...actual,
    usePathname: vi.fn(),
  }
})

vi.mock('../index', () => ({
  MainNav: ({ className }: { className?: string }) => <aside className={className} data-testid="main-nav">MainNav</aside>,
}))

describe('MainNavLayout', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    useAppStore.getState().setAppDetail()
    ;(usePathname as Mock).mockReturnValue('/apps')
    ;(useAppContext as Mock).mockReturnValue({
      isCurrentWorkspaceDatasetOperator: false,
      isCurrentWorkspaceEditor: true,
    })
    ;(useSuspenseQuery as Mock).mockReturnValue({
      data: {
        enable_app_deploy: true,
      },
    })
    ;(isAgentV2Enabled as Mock).mockReturnValue(true)
  })

  it('renders desktop main nav instead of the desktop header', () => {
    render(<MainNavLayout><div>content</div></MainNavLayout>)

    expect(screen.getByTestId('main-nav')).toBeInTheDocument()
    expect(screen.queryByTestId('desktop-header')).not.toBeInTheDocument()
    expect(screen.getByText('content')).toBeInTheDocument()
  })

  it('uses the main nav without the desktop header wrapper', () => {
    render(<MainNavLayout><div>content</div></MainNavLayout>)

    expect(screen.getByTestId('main-nav')).toBeInTheDocument()
    expect(screen.queryByTestId('header-wrapper')).not.toBeInTheDocument()
    expect(screen.queryByTestId('desktop-header')).not.toBeInTheDocument()
  })

  it('renders one main landmark as the skip navigation target', () => {
    render(<MainNavLayout><div>content</div></MainNavLayout>)

    const main = screen.getByRole('main')

    expect(screen.getAllByRole('main')).toHaveLength(1)
    expect(main).toHaveAttribute('id', 'main-content')
    expect(main).toHaveAttribute('tabIndex', '-1')
    expect(main).toHaveClass('outline-hidden', 'focus:outline-hidden', 'focus-visible:outline-hidden')
    expect(main).toHaveTextContent('content')
  })

  it('renders skip navigation before the repeated main navigation', () => {
    const { container } = render(<MainNavLayout><div>content</div></MainNavLayout>)

    const skipLink = screen.getByRole('link', { name: 'navigation.skipToMain' })

    expect(skipLink).toHaveAttribute('href', '#main-content')
    expect(skipLink).toHaveClass('outline-hidden', 'focus-visible:ring-2', 'focus-visible:ring-state-accent-solid')
    expect(container.querySelector('a, button, input, select, textarea, [tabindex]:not([tabindex="-1"])')).toBe(skipLink)
  })

  it('moves focus to the main content when skip navigation is activated', () => {
    render(<MainNavLayout><div>content</div></MainNavLayout>)

    const skipLink = screen.getByRole('link', { name: 'navigation.skipToMain' })
    const main = screen.getByRole('main')

    fireEvent.click(skipLink)

    expect(main).toHaveFocus()
  })

  it('lets detail routes own their sidebar instead of rendering the global main nav', () => {
    ;(usePathname as Mock).mockReturnValue('/datasets/dataset-1/documents')

    render(
      <MainNavLayout>
        <main id={MAIN_CONTENT_ID} tabIndex={-1}>
          dataset detail
        </main>
      </MainNavLayout>,
    )

    expect(screen.queryByTestId('main-nav')).not.toBeInTheDocument()
    expect(screen.getAllByRole('main')).toHaveLength(1)
    expect(screen.getByRole('main')).toHaveTextContent('dataset detail')
  })

  it.each([
    '/datasets/create',
    '/datasets/dataset-1/documents/create',
    '/deployments/create',
  ])('keeps the global main nav on collection and creation route %s', (pathname) => {
    ;(usePathname as Mock).mockReturnValue(pathname)

    render(<MainNavLayout><div>content</div></MainNavLayout>)

    expect(screen.getByTestId('main-nav')).toBeInTheDocument()
  })

  it('clears app detail state after leaving app routes', () => {
    useAppStore.getState().setAppDetail({ id: 'app-1' } as ReturnType<typeof useAppStore.getState>['appDetail'])
    ;(usePathname as Mock).mockReturnValue('/datasets')

    render(<MainNavLayout><div>content</div></MainNavLayout>)

    expect(useAppStore.getState().appDetail).toBeUndefined()
  })
})
