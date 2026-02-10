import { render, screen } from '@testing-library/react'
import * as React from 'react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}))

vi.mock('@remixicon/react', () => ({
  RiCloseLine: () => <span data-testid="icon-close" />,
}))

vi.mock('@/app/components/base/checkbox', () => ({
  default: ({ checked, disabled }: { checked: boolean, disabled: boolean }) => (
    <input type="checkbox" data-testid="checkbox" checked={checked} disabled={disabled} readOnly />
  ),
}))

vi.mock('@/app/components/plugins/card/base/placeholder', () => ({
  LoadingPlaceholder: () => <div data-testid="loading-placeholder" />,
}))

vi.mock('../../../base/icons/src/vender/other', () => ({
  Group: ({ className }: { className: string }) => <span data-testid="group-icon" className={className} />,
}))

describe('LoadingError', () => {
  let LoadingError: React.FC

  beforeEach(async () => {
    vi.clearAllMocks()
    const mod = await import('./loading-error')
    LoadingError = mod.default
  })

  it('should render error message', () => {
    render(<LoadingError />)

    expect(screen.getByText('installModal.pluginLoadError')).toBeInTheDocument()
    expect(screen.getByText('installModal.pluginLoadErrorDesc')).toBeInTheDocument()
  })

  it('should render disabled checkbox', () => {
    render(<LoadingError />)

    const checkbox = screen.getByTestId('checkbox')
    expect(checkbox).toBeDisabled()
  })

  it('should render error icon with close indicator', () => {
    render(<LoadingError />)

    expect(screen.getByTestId('icon-close')).toBeInTheDocument()
    expect(screen.getByTestId('group-icon')).toBeInTheDocument()
  })

  it('should render loading placeholder', () => {
    render(<LoadingError />)

    expect(screen.getByTestId('loading-placeholder')).toBeInTheDocument()
  })
})
