import { render, screen } from '@testing-library/react'
import { vi } from 'vitest'
import { usePathname } from '@/next/navigation'
import HeaderWrapper from '../header-wrapper'

vi.mock('@/next/navigation', () => ({
  usePathname: vi.fn(),
}))

describe('HeaderWrapper', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    vi.mocked(usePathname).mockReturnValue('/test')
  })

  it('should render children correctly', () => {
    render(
      <HeaderWrapper>
        <div data-testid="child">Test Child</div>
      </HeaderWrapper>,
    )
    expect(screen.getByTestId('child')).toBeInTheDocument()
    expect(screen.getByText('Test Child')).toBeInTheDocument()
  })

  it('should keep children mounted on workflow routes', () => {
    vi.mocked(usePathname).mockReturnValue('/some/path/workflow')
    render(
      <HeaderWrapper>
        <div>Workflow Content</div>
      </HeaderWrapper>,
    )

    expect(screen.getByText('Workflow Content')).toBeInTheDocument()
  })

  it('should keep children mounted on pipeline routes', () => {
    vi.mocked(usePathname).mockReturnValue('/some/path/pipeline')

    render(
      <HeaderWrapper>
        <div>Pipeline Content</div>
      </HeaderWrapper>,
    )

    expect(screen.getByText('Pipeline Content')).toBeInTheDocument()
  })

  it('should keep children mounted on non-canvas routes', () => {
    vi.mocked(usePathname).mockReturnValue('/apps')

    render(
      <HeaderWrapper>
        <div>App Content</div>
      </HeaderWrapper>,
    )

    expect(screen.getByText('App Content')).toBeInTheDocument()
  })
})
