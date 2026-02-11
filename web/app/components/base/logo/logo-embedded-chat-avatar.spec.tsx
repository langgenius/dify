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
      expect(img).toHaveClass('h-10')
      expect(img).toHaveClass('w-10')
    })
  })

  describe('Props', () => {
    it('applies custom className correctly', () => {
      const customClass = 'custom-avatar-class'
      render(<LogoEmbeddedChatAvatar className={customClass} />)
      const img = screen.getByRole('img', { name: /logo/i })
      expect(img).toHaveClass(customClass)
      expect(img).toHaveClass('h-10')
    })

    it('has valid alt text', () => {
      render(<LogoEmbeddedChatAvatar />)
      const img = screen.getByRole('img', { name: /logo/i })
      expect(img).toHaveAttribute('alt', 'logo')
    })
  })
})
