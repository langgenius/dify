import { fireEvent, render, screen } from '@testing-library/react'
import * as React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}))

vi.mock('@/app/components/base/badge/index', () => ({
  default: ({ children }: { children: React.ReactNode }) => <span data-testid="badge">{children}</span>,
  BadgeState: { Default: 'default', Warning: 'warning' },
}))

vi.mock('@/app/components/base/button', () => ({
  default: ({ children, onClick }: { children: React.ReactNode, onClick?: () => void }) => (
    <button onClick={onClick}>{children}</button>
  ),
}))

vi.mock('../../card', () => ({
  default: ({ installed, installFailed, titleLeft }: { installed: boolean, installFailed: boolean, titleLeft?: React.ReactNode }) => (
    <div data-testid="card" data-installed={installed} data-failed={installFailed}>{titleLeft}</div>
  ),
}))

vi.mock('../utils', () => ({
  pluginManifestInMarketToPluginProps: (p: unknown) => p,
  pluginManifestToCardPluginProps: (p: unknown) => p,
}))

describe('Installed', () => {
  let Installed: (typeof import('./installed'))['default']

  beforeEach(async () => {
    vi.clearAllMocks()
    const mod = await import('./installed')
    Installed = mod.default
  })

  it('should render success message when not failed', () => {
    render(<Installed isFailed={false} onCancel={vi.fn()} />)

    expect(screen.getByText('installModal.installedSuccessfullyDesc')).toBeInTheDocument()
  })

  it('should render failure message when failed', () => {
    render(<Installed isFailed={true} onCancel={vi.fn()} />)

    expect(screen.getByText('installModal.installFailedDesc')).toBeInTheDocument()
  })

  it('should render custom error message when provided', () => {
    render(<Installed isFailed={true} errMsg="Custom error" onCancel={vi.fn()} />)

    expect(screen.getByText('Custom error')).toBeInTheDocument()
  })

  it('should render card with payload', () => {
    const payload = { version: '1.0.0', name: 'test-plugin' } as never
    render(<Installed payload={payload} isFailed={false} onCancel={vi.fn()} />)

    const card = screen.getByTestId('card')
    expect(card).toHaveAttribute('data-installed', 'true')
    expect(card).toHaveAttribute('data-failed', 'false')
  })

  it('should render card as failed when isFailed', () => {
    const payload = { version: '1.0.0', name: 'test-plugin' } as never
    render(<Installed payload={payload} isFailed={true} onCancel={vi.fn()} />)

    const card = screen.getByTestId('card')
    expect(card).toHaveAttribute('data-installed', 'false')
    expect(card).toHaveAttribute('data-failed', 'true')
  })

  it('should call onCancel when close button clicked', () => {
    const mockOnCancel = vi.fn()
    render(<Installed isFailed={false} onCancel={mockOnCancel} />)

    fireEvent.click(screen.getByText('operation.close'))
    expect(mockOnCancel).toHaveBeenCalled()
  })

  it('should show version badge in card', () => {
    const payload = { version: '1.0.0', name: 'test-plugin' } as never
    render(<Installed payload={payload} isFailed={false} onCancel={vi.fn()} />)

    expect(screen.getByTestId('badge')).toHaveTextContent('1.0.0')
  })

  it('should not render card when no payload', () => {
    render(<Installed isFailed={false} onCancel={vi.fn()} />)

    expect(screen.queryByTestId('card')).not.toBeInTheDocument()
  })
})
