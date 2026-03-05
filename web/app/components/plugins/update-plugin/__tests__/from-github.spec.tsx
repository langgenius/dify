import { render, screen } from '@testing-library/react'
import * as React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/app/components/plugins/install-plugin/install-from-github', () => ({
  default: ({ updatePayload, onClose, onSuccess }: {
    updatePayload?: Record<string, unknown>
    onClose: () => void
    onSuccess: () => void
  }) => (
    <div data-testid="install-from-github">
      <span data-testid="update-payload">{JSON.stringify(updatePayload)}</span>
      <button data-testid="close-btn" onClick={onClose}>Close</button>
      <button data-testid="success-btn" onClick={onSuccess}>Success</button>
    </div>
  ),
}))

describe('FromGitHub', () => {
  let FromGitHub: (typeof import('../from-github'))['default']

  beforeEach(async () => {
    vi.clearAllMocks()
    const mod = await import('../from-github')
    FromGitHub = mod.default
  })

  it('should render InstallFromGitHub with update payload', () => {
    const payload = { id: '1', owner: 'test', repo: 'plugin' } as never
    render(<FromGitHub payload={payload} onSave={vi.fn()} onCancel={vi.fn()} />)

    expect(screen.getByTestId('install-from-github')).toBeInTheDocument()
    expect(screen.getByTestId('update-payload')).toHaveTextContent(JSON.stringify(payload))
  })

  it('should call onCancel when close is triggered', () => {
    const mockOnCancel = vi.fn()
    render(<FromGitHub payload={{} as never} onSave={vi.fn()} onCancel={mockOnCancel} />)

    screen.getByTestId('close-btn').click()
    expect(mockOnCancel).toHaveBeenCalled()
  })

  it('should call onSave on success', () => {
    const mockOnSave = vi.fn()
    render(<FromGitHub payload={{} as never} onSave={mockOnSave} onCancel={vi.fn()} />)

    screen.getByTestId('success-btn').click()
    expect(mockOnSave).toHaveBeenCalled()
  })
})
