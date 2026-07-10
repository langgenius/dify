import { fireEvent, render, screen } from '@testing-library/react'
import * as React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PluginCategoryEnum } from '../../../types'

vi.mock('../../../card', () => ({
  default: ({ installed, installFailed, titleLeft }: { installed: boolean, installFailed: boolean, titleLeft?: React.ReactNode }) => (
    <div data-testid="card" data-installed={installed} data-failed={installFailed}>{titleLeft}</div>
  ),
}))

vi.mock('../../utils', () => ({
  pluginManifestInMarketToPluginProps: (p: unknown) => p,
  pluginManifestToCardPluginProps: (p: unknown) => p,
}))

describe('Installed', () => {
  let Installed: (typeof import('../installed'))['default']

  beforeEach(async () => {
    vi.clearAllMocks()
    const mod = await import('../installed')
    Installed = mod.default
  })

  it('should render success message when not failed', () => {
    render(<Installed isFailed={false} onCancel={vi.fn()} />)

    expect(screen.getByText('plugin.installModal.installedSuccessfullyDesc')).toBeInTheDocument()
  })

  it('should render failure message when failed', () => {
    render(<Installed isFailed={true} onCancel={vi.fn()} />)

    expect(screen.getByText('plugin.installModal.installFailedDesc')).toBeInTheDocument()
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

    fireEvent.click(screen.getByText('common.operation.close'))
    expect(mockOnCancel).toHaveBeenCalled()
  })

  it('should keep close action when installed category matches integrations context', () => {
    const mockOnCancel = vi.fn()
    const payload = {
      category: PluginCategoryEnum.extension,
      name: 'test-plugin',
      version: '1.0.0',
    } as never
    render(<Installed payload={payload} installContextCategory={PluginCategoryEnum.extension} isFailed={false} onCancel={mockOnCancel} />)

    fireEvent.click(screen.getByText('common.operation.close'))

    expect(mockOnCancel).toHaveBeenCalled()
    expect(screen.getByText('common.operation.close').closest('a')).not.toBeInTheDocument()
  })

  it('should navigate to the installed category when integrations context differs', () => {
    const mockOnCancel = vi.fn()
    const payload = {
      category: PluginCategoryEnum.extension,
      name: 'test-plugin',
      version: '1.0.0',
    } as never
    render(<Installed payload={payload} installContextCategory={PluginCategoryEnum.trigger} isFailed={false} onCancel={mockOnCancel} />)

    expect(screen.getByText('plugin.installModal.installedSuccessfullyWithPageDesc')).toBeInTheDocument()

    fireEvent.click(screen.getByText('plugin.installModal.viewDetails'))

    expect(mockOnCancel).toHaveBeenCalled()
    expect(screen.getByText('plugin.installModal.viewDetails').closest('a')).toHaveAttribute('href', '/integrations/extension')
    expect(document.querySelector('.i-ri-arrow-right-up-line')).toBeInTheDocument()
  })

  it('should show version badge in card', () => {
    const payload = { version: '1.0.0', name: 'test-plugin' } as never
    render(<Installed payload={payload} isFailed={false} onCancel={vi.fn()} />)

    expect(screen.getByText('1.0.0')).toBeInTheDocument()
  })

  it('should not render card when no payload', () => {
    render(<Installed isFailed={false} onCancel={vi.fn()} />)

    expect(screen.queryByTestId('card')).not.toBeInTheDocument()
  })
})
