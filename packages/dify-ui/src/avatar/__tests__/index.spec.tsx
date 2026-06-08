import { render } from 'vitest-browser-react'
import { Avatar, AvatarFallback, AvatarImage, AvatarRoot } from '..'

describe('Avatar', () => {
  describe('Rendering', () => {
    it('should keep the fallback visible when avatar URL is provided before image load', async () => {
      const screen = await render(<Avatar name="John Doe" avatar="https://example.com/avatar.jpg" />)

      await expect.element(screen.getByText('J')).toBeInTheDocument()
    })

    it('should render fallback with uppercase initial when avatar is null', async () => {
      const screen = await render(<Avatar name="alice" avatar={null} />)

      expect(screen.container.querySelector('img')).not.toBeInTheDocument()
      await expect.element(screen.getByText('A')).toBeInTheDocument()
    })

    it('should render the fallback when avatar is provided', async () => {
      const screen = await render(<Avatar name="John" avatar="https://example.com/avatar.jpg" />)

      await expect.element(screen.getByText('J')).toBeInTheDocument()
    })
  })

  describe('Size variants', () => {
    it.each([
      { size: 'xxs' as const, expectedClass: 'size-4' },
      { size: 'xs' as const, expectedClass: 'size-5' },
      { size: 'sm' as const, expectedClass: 'size-6' },
      { size: 'md' as const, expectedClass: 'size-8' },
      { size: 'lg' as const, expectedClass: 'size-9' },
      { size: 'xl' as const, expectedClass: 'size-10' },
      { size: '2xl' as const, expectedClass: 'size-12' },
      { size: '3xl' as const, expectedClass: 'size-16' },
    ])('should apply $expectedClass for size="$size"', async ({ size, expectedClass }) => {
      const screen = await render(<Avatar name="Test" avatar={null} size={size} />)

      const root = screen.container.firstElementChild as HTMLElement
      expect(root).toHaveClass(expectedClass)
    })

    it('should default to md size when size is not specified', async () => {
      const screen = await render(<Avatar name="Test" avatar={null} />)

      const root = screen.container.firstElementChild as HTMLElement
      expect(root).toHaveClass('size-8')
    })
  })

  describe('className prop', () => {
    it('should merge className with avatar variant classes on root', async () => {
      const screen = await render(
        <Avatar name="Test" avatar={null} className="custom-class" />,
      )

      const root = screen.container.firstElementChild as HTMLElement
      expect(root).toHaveClass('custom-class')
      expect(root).toHaveClass('rounded-full', 'bg-primary-600')
    })
  })

  describe('Primitives', () => {
    it('should support composed avatar usage through exported primitives', async () => {
      const screen = await render(
        <AvatarRoot size="sm" data-testid="avatar-root">
          <AvatarImage src="https://example.com/avatar.jpg" alt="Jane Doe" />
          <AvatarFallback size="sm" style={{ backgroundColor: 'rgb(1, 2, 3)' }}>
            J
          </AvatarFallback>
        </AvatarRoot>,
      )

      await expect.element(screen.getByTestId('avatar-root')).toHaveClass('size-6')
      await expect.element(screen.getByText('J')).toBeInTheDocument()
      await expect.element(screen.getByText('J')).toHaveStyle({ backgroundColor: 'rgb(1, 2, 3)' })
    })
  })

  describe('Edge Cases', () => {
    it('should handle empty string name gracefully', async () => {
      const screen = await render(<Avatar name="" avatar={null} />)

      const fallback = screen.container.querySelector('.text-white') as HTMLElement
      expect(fallback).toBeInTheDocument()
      expect(fallback.textContent).toBe('')
    })

    it.each([
      { name: '中文名', expected: '中', label: 'Chinese characters' },
      { name: '123User', expected: '1', label: 'number' },
    ])('should display first character when name starts with $label', async ({ name, expected }) => {
      const screen = await render(<Avatar name={name} avatar={null} />)

      await expect.element(screen.getByText(expected)).toBeInTheDocument()
    })

    it('should handle empty string avatar as falsy value', async () => {
      const screen = await render(<Avatar name="Test" avatar={'' as string | null} />)

      expect(screen.container.querySelector('img')).not.toBeInTheDocument()
      await expect.element(screen.getByText('T')).toBeInTheDocument()
    })
  })

  describe('onLoadingStatusChange', () => {
    it('should render the fallback when avatar and onLoadingStatusChange are provided', async () => {
      const screen = await render(
        <Avatar
          name="John"
          avatar="https://example.com/avatar.jpg"
          onLoadingStatusChange={vi.fn()}
        />,
      )

      await expect.element(screen.getByText('J')).toBeInTheDocument()
    })

    it('should not render image when avatar is null even with onLoadingStatusChange', async () => {
      const onStatusChange = vi.fn()
      const screen = await render(
        <Avatar name="John" avatar={null} onLoadingStatusChange={onStatusChange} />,
      )

      expect(screen.container.querySelector('img')).not.toBeInTheDocument()
    })
  })
})
