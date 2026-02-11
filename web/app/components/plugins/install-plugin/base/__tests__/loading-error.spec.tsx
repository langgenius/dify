import { render, screen } from '@testing-library/react'
import * as React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/app/components/plugins/card/base/placeholder', () => ({
  LoadingPlaceholder: () => <div data-testid="loading-placeholder" />,
}))

vi.mock('../../../../base/icons/src/vender/other', () => ({
  Group: ({ className }: { className: string }) => <span data-testid="group-icon" className={className} />,
}))

describe('LoadingError', () => {
  let LoadingError: React.FC

  beforeEach(async () => {
    vi.clearAllMocks()
    const mod = await import('../loading-error')
    LoadingError = mod.default
  })

  it('should render error message', () => {
    render(<LoadingError />)

    expect(screen.getByText('plugin.installModal.pluginLoadError')).toBeInTheDocument()
    expect(screen.getByText('plugin.installModal.pluginLoadErrorDesc')).toBeInTheDocument()
  })

  it('should render disabled checkbox', () => {
    render(<LoadingError />)

    expect(screen.getByTestId('checkbox-undefined')).toBeInTheDocument()
  })

  it('should render error icon with close indicator', () => {
    render(<LoadingError />)

    expect(screen.getByTestId('group-icon')).toBeInTheDocument()
  })

  it('should render loading placeholder', () => {
    render(<LoadingError />)

    expect(screen.getByTestId('loading-placeholder')).toBeInTheDocument()
  })
})
