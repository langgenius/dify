import { render, screen } from '@testing-library/react'
import LogoEmbeddedChatHeader from './logo-embedded-chat-header'

vi.mock('@/utils/var', () => ({
  basePath: '/test-base-path',
}))

describe('LogoEmbeddedChatHeader', () => {
  it('renders correctly with default props', () => {
    const { container } = render(<LogoEmbeddedChatHeader />)
    const img = screen.getByRole('img', { name: /logo/i })
    expect(img).toBeInTheDocument()
    expect(img).toHaveAttribute('src', '/test-base-path/logo/logo-embedded-chat-header.png')

    const sources = container.querySelectorAll('source')
    expect(sources).toHaveLength(3)
    expect(sources[0]).toHaveAttribute('srcSet', '/logo/logo-embedded-chat-header.png')
    expect(sources[1]).toHaveAttribute('srcSet', '/logo/logo-embedded-chat-header@2x.png')
    expect(sources[2]).toHaveAttribute('srcSet', '/logo/logo-embedded-chat-header@3x.png')
  })

  it('applies custom className correctly', () => {
    const customClass = 'custom-header-class'
    render(<LogoEmbeddedChatHeader className={customClass} />)
    const img = screen.getByRole('img', { name: /logo/i })
    expect(img).toHaveClass(customClass)
    expect(img).toHaveClass('h-6')
  })
})
