import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import DowngradeWarningModal from '../downgrade-warning'

describe('DowngradeWarningModal', () => {
  const mockOnCancel = vi.fn()
  const mockOnJustDowngrade = vi.fn()
  const mockOnExcludeAndDowngrade = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    cleanup()
  })

  it('renders title and description', () => {
    render(
      <DowngradeWarningModal
        onCancel={mockOnCancel}
        onJustDowngrade={mockOnJustDowngrade}
        onExcludeAndDowngrade={mockOnExcludeAndDowngrade}
      />,
    )
    expect(screen.getByText('plugin.autoUpdate.pluginDowngradeWarning.title')).toBeInTheDocument()
    expect(screen.getByText('plugin.autoUpdate.pluginDowngradeWarning.description')).toBeInTheDocument()
  })

  it('renders three action buttons', () => {
    render(
      <DowngradeWarningModal
        onCancel={mockOnCancel}
        onJustDowngrade={mockOnJustDowngrade}
        onExcludeAndDowngrade={mockOnExcludeAndDowngrade}
      />,
    )
    expect(screen.getByText('app.newApp.Cancel')).toBeInTheDocument()
    expect(screen.getByText('plugin.autoUpdate.pluginDowngradeWarning.downgrade')).toBeInTheDocument()
    expect(screen.getByText('plugin.autoUpdate.pluginDowngradeWarning.exclude')).toBeInTheDocument()
  })

  it('calls onCancel when Cancel is clicked', () => {
    render(
      <DowngradeWarningModal
        onCancel={mockOnCancel}
        onJustDowngrade={mockOnJustDowngrade}
        onExcludeAndDowngrade={mockOnExcludeAndDowngrade}
      />,
    )
    fireEvent.click(screen.getByText('app.newApp.Cancel'))
    expect(mockOnCancel).toHaveBeenCalledTimes(1)
  })

  it('calls onJustDowngrade when downgrade button is clicked', () => {
    render(
      <DowngradeWarningModal
        onCancel={mockOnCancel}
        onJustDowngrade={mockOnJustDowngrade}
        onExcludeAndDowngrade={mockOnExcludeAndDowngrade}
      />,
    )
    fireEvent.click(screen.getByText('plugin.autoUpdate.pluginDowngradeWarning.downgrade'))
    expect(mockOnJustDowngrade).toHaveBeenCalledTimes(1)
  })

  it('calls onExcludeAndDowngrade when exclude button is clicked', () => {
    render(
      <DowngradeWarningModal
        onCancel={mockOnCancel}
        onJustDowngrade={mockOnJustDowngrade}
        onExcludeAndDowngrade={mockOnExcludeAndDowngrade}
      />,
    )
    fireEvent.click(screen.getByText('plugin.autoUpdate.pluginDowngradeWarning.exclude'))
    expect(mockOnExcludeAndDowngrade).toHaveBeenCalledTimes(1)
  })
})
