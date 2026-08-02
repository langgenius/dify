import type { ReactNode } from 'react'
import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import Home from '../page'

const mocks = vi.hoisted(() => ({
  useDocumentTitle: vi.fn(),
  suspendHomeContent: false,
}))

vi.mock('@/hooks/use-document-title', () => ({
  default: mocks.useDocumentTitle,
}))

vi.mock('@/app/components/explore/app-list', () => ({
  HomeAppListContent: () => <div data-testid="home-content">content</div>,
}))

vi.mock('../home-hydration-boundary', () => ({
  HomeHydrationBoundary: ({ children }: { children: ReactNode }) => {
    if (mocks.suspendHomeContent) throw new Promise(() => {})

    return <>{children}</>
  },
}))

vi.mock('@/app/components/explore/banner/home-banner', () => ({
  HomeBanner: () => <div data-testid="home-banner">banner</div>,
}))

describe('Home', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.suspendHomeContent = false
  })

  it('should keep the title client island and banner outside the route hydration boundary', () => {
    render(<Home />)

    expect(mocks.useDocumentTitle).toHaveBeenCalledWith('common.mainNav.home')
    expect(screen.getByTestId('home-banner')).toBeInTheDocument()
    expect(screen.getByTestId('home-content')).toBeInTheDocument()
  })

  it('should keep the banner visible with a stable Home content fallback while prefetching', () => {
    mocks.suspendHomeContent = true

    render(<Home />)

    expect(screen.getByTestId('home-banner')).toBeInTheDocument()
    expect(screen.getAllByRole('status', { name: 'common.loading' })).toHaveLength(2)
  })
})
