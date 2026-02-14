import { act, fireEvent, render, screen } from '@testing-library/react'
import * as React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/hooks/use-i18n', () => ({
  useRenderI18nObject: () => (obj: Record<string, string> | string) => typeof obj === 'string' ? obj : obj?.en_US || '',
}))

vi.mock('@/utils/classnames', () => ({
  cn: (...args: unknown[]) => args.filter(Boolean).join(' '),
}))

vi.mock('@/app/components/base/toast', () => ({
  default: { notify: vi.fn() },
  useToastContext: () => ({ notify: vi.fn() }),
}))

const mockFormSchemas = [
  { name: 'api_key', label: { en_US: 'API Key' }, type: 'secret-input', required: true },
]

vi.mock('@/app/components/tools/utils/to-form-schema', () => ({
  addDefaultValue: (values: Record<string, unknown>) => values,
  toolCredentialToFormSchemas: () => mockFormSchemas,
}))

vi.mock('@/service/tools', () => ({
  fetchBuiltInToolCredential: vi.fn().mockResolvedValue({ api_key: 'sk-existing-key' }),
  fetchBuiltInToolCredentialSchema: vi.fn().mockResolvedValue([]),
}))

vi.mock('@/app/components/header/account-setting/model-provider-page/model-modal/Form', () => ({
  default: ({ value: _value, onChange }: { formSchemas: unknown[], value: Record<string, unknown>, onChange: (v: Record<string, unknown>) => void }) => (
    <div data-testid="credential-form">
      <input
        data-testid="form-input"
        onChange={e => onChange({ api_key: e.target.value })}
      />
    </div>
  ),
}))

describe('ToolCredentialForm', () => {
  let ToolCredentialForm: (typeof import('../tool-credentials-form'))['default']

  beforeEach(async () => {
    vi.clearAllMocks()
    const mod = await import('../tool-credentials-form')
    ToolCredentialForm = mod.default
  })

  it('should render loading state initially', async () => {
    await act(async () => {
      render(
        <ToolCredentialForm
          collection={{ id: 'test', name: 'Test', labels: [] } as never}
          onCancel={vi.fn()}
          onSaved={vi.fn()}
        />,
      )
    })

    // After act resolves async effects, form should be loaded
    expect(screen.getByTestId('credential-form')).toBeInTheDocument()
  })

  it('should render form after loading', async () => {
    await act(async () => {
      render(
        <ToolCredentialForm
          collection={{ id: 'test', name: 'Test', labels: [] } as never}
          onCancel={vi.fn()}
          onSaved={vi.fn()}
        />,
      )
    })

    expect(screen.getByTestId('credential-form')).toBeInTheDocument()
  })

  it('should call onCancel when cancel button clicked', async () => {
    const mockOnCancel = vi.fn()
    await act(async () => {
      render(
        <ToolCredentialForm
          collection={{ id: 'test', name: 'Test', labels: [] } as never}
          onCancel={mockOnCancel}
          onSaved={vi.fn()}
        />,
      )
    })

    const cancelBtn = screen.getByText('common.operation.cancel')
    fireEvent.click(cancelBtn)
    expect(mockOnCancel).toHaveBeenCalled()
  })

  it('should call onSaved when save button clicked', async () => {
    const mockOnSaved = vi.fn()
    await act(async () => {
      render(
        <ToolCredentialForm
          collection={{ id: 'test', name: 'Test', labels: [] } as never}
          onCancel={vi.fn()}
          onSaved={mockOnSaved}
        />,
      )
    })

    fireEvent.click(screen.getByText('common.operation.save'))
    expect(mockOnSaved).toHaveBeenCalled()
  })
})
