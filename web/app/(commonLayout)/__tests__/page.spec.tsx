import type { ReactNode } from 'react'
import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import Home from '../page'

const mocks = vi.hoisted(() => ({
  useDocumentTitle: vi.fn(),
}))

vi.mock('@/hooks/use-document-title', () => ({
  default: mocks.useDocumentTitle,
}))

vi.mock('@/app/components/explore/app-list', () => ({
  default: ({ children }: { children: ReactNode }) => (
    <main data-testid="home-body">{children}</main>
  ),
}))

vi.mock('@/app/components/explore/banner/home-banner', () => ({
  HomeBanner: () => <div data-testid="home-banner">banner</div>,
}))

describe('Home', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should keep the title client island and banner server child inside the home body', () => {
    render(<Home />)

    expect(mocks.useDocumentTitle).toHaveBeenCalledWith('common.mainNav.home')
    expect(screen.getByTestId('home-body')).toContainElement(screen.getByTestId('home-banner'))
  })
})
