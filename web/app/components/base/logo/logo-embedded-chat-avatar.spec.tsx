import { render, screen } from '@testing-library/react'
import LogoEmbeddedChatAvatar from './logo-embedded-chat-avatar'

vi.mock('@/utils/var', () => ({
  basePath: '/test-base-path',
}))

describe('LogoEmbeddedChatAvatar', () => {
  describe('Render', () => {
    it('renders correctly with default props', () => {
      render(<LogoEmbeddedChatAvatar />)
      const img = screen.getByRole('img', { name: /logo/i })
      expect(img).toBeInTheDocument()
      expect(img).toHaveAttribute('src', '/test-base-path/logo/logo-embedded-chat-avatar.png')
    })
  })

  describe('Props', () => {
    it('applies custom className correctly', () => {
      const customClass = 'custom-avatar-class'
      render(<LogoEmbeddedChatAvatar className={customClass} />)
      const img = screen.getByRole('img', { name: /logo/i })
      expect(img).toHaveClass(customClass)
    })

    it('has valid alt text', () => {
      render(<LogoEmbeddedChatAvatar />)
      const img = screen.getByRole('img', { name: /logo/i })
      expect(img).toHaveAttribute('alt', 'logo')
    })
  })
})
