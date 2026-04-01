import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import Icon from '../card-icon'

vi.mock('@/app/components/base/app-icon', () => ({
  default: ({ icon, background }: { icon: string, background: string }) => (
    <div data-testid="app-icon" data-icon={icon} data-bg={background} />
  ),
}))

vi.mock('@/app/components/base/icons/src/vender/other', () => ({
  Mcp: () => <span data-testid="mcp-icon" />,
}))

vi.mock('@/utils/mcp', () => ({
  shouldUseMcpIcon: () => false,
}))

describe('Icon', () => {
  it('renders string src as background image', () => {
    const { container } = render(<Icon src="https://example.com/icon.png" />)
    const el = container.firstChild as HTMLElement
    expect(el.style.backgroundImage).toContain('https://example.com/icon.png')
  })

  it('renders emoji src using AppIcon', () => {
    render(<Icon src={{ content: '🔍', background: '#fff' }} />)
    expect(screen.getByTestId('app-icon')).toBeInTheDocument()
    expect(screen.getByTestId('app-icon')).toHaveAttribute('data-icon', '🔍')
    expect(screen.getByTestId('app-icon')).toHaveAttribute('data-bg', '#fff')
  })

  it('shows check icon when installed', () => {
    const { container } = render(<Icon src="icon.png" installed />)
    expect(container.querySelector('.bg-state-success-solid')).toBeInTheDocument()
  })

  it('shows close icon when installFailed', () => {
    const { container } = render(<Icon src="icon.png" installFailed />)
    expect(container.querySelector('.bg-state-destructive-solid')).toBeInTheDocument()
  })

  it('does not show status icons by default', () => {
    const { container } = render(<Icon src="icon.png" />)
    expect(container.querySelector('.bg-state-success-solid')).not.toBeInTheDocument()
    expect(container.querySelector('.bg-state-destructive-solid')).not.toBeInTheDocument()
  })

  it('applies custom className', () => {
    const { container } = render(<Icon src="icon.png" className="my-class" />)
    const el = container.firstChild as HTMLElement
    expect(el.className).toContain('my-class')
  })

  it('applies correct size class', () => {
    const { container } = render(<Icon src="icon.png" size="small" />)
    const el = container.firstChild as HTMLElement
    expect(el.className).toContain('w-8')
    expect(el.className).toContain('h-8')
  })
})
