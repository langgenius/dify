import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import DowngradeWarningModal from './downgrade-warning'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const map: Record<string, string> = {
        'autoUpdate.pluginDowngradeWarning.title': 'Downgrade Warning',
        'autoUpdate.pluginDowngradeWarning.description': 'This will downgrade the plugin.',
        'newApp.Cancel': 'Cancel',
        'autoUpdate.pluginDowngradeWarning.downgrade': 'Just Downgrade',
        'autoUpdate.pluginDowngradeWarning.exclude': 'Exclude & Downgrade',
      }
      return map[key] || key
    },
  }),
}))

vi.mock('@/app/components/base/button', () => ({
  default: ({ children, onClick, variant, destructive }: {
    children: React.ReactNode
    onClick?: () => void
    variant?: string
    destructive?: boolean
  }) => (
    <button
      data-testid={`btn-${variant}${destructive ? '-destructive' : ''}`}
      onClick={onClick}
    >
      {children}
    </button>
  ),
}))

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
    expect(screen.getByText('Downgrade Warning')).toBeInTheDocument()
    expect(screen.getByText('This will downgrade the plugin.')).toBeInTheDocument()
  })

  it('renders three action buttons', () => {
    render(
      <DowngradeWarningModal
        onCancel={mockOnCancel}
        onJustDowngrade={mockOnJustDowngrade}
        onExcludeAndDowngrade={mockOnExcludeAndDowngrade}
      />,
    )
    expect(screen.getByText('Cancel')).toBeInTheDocument()
    expect(screen.getByText('Just Downgrade')).toBeInTheDocument()
    expect(screen.getByText('Exclude & Downgrade')).toBeInTheDocument()
  })

  it('calls onCancel when Cancel is clicked', () => {
    render(
      <DowngradeWarningModal
        onCancel={mockOnCancel}
        onJustDowngrade={mockOnJustDowngrade}
        onExcludeAndDowngrade={mockOnExcludeAndDowngrade}
      />,
    )
    fireEvent.click(screen.getByText('Cancel'))
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
    fireEvent.click(screen.getByText('Just Downgrade'))
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
    fireEvent.click(screen.getByText('Exclude & Downgrade'))
    expect(mockOnExcludeAndDowngrade).toHaveBeenCalledTimes(1)
  })
})
