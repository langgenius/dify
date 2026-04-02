import { fireEvent, render, screen } from '@testing-library/react'
import * as React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/app/components/base/textarea', () => ({
  default: ({ value, onChange, disabled, placeholder }: {
    value?: string
    onChange?: (e: React.ChangeEvent<HTMLTextAreaElement>) => void
    disabled?: boolean
    placeholder?: string
  }) => (
    <textarea
      data-testid="description-textarea"
      value={value || ''}
      onChange={onChange}
      disabled={disabled}
      placeholder={placeholder}
    />
  ),
}))

vi.mock('../../../../readme-panel/entrance', () => ({
  ReadmeEntrance: () => <div data-testid="readme-entrance" />,
}))

vi.mock('@/app/components/workflow/block-selector/tool-picker', () => ({
  default: ({ trigger }: { trigger: React.ReactNode }) => (
    <div data-testid="tool-picker">{trigger}</div>
  ),
}))

vi.mock('../tool-trigger', () => ({
  default: ({ value, provider }: { open?: boolean, value?: unknown, provider?: unknown }) => (
    <div data-testid="tool-trigger" data-has-value={!!value} data-has-provider={!!provider} />
  ),
}))

const mockOnDescriptionChange = vi.fn()
const mockOnShowChange = vi.fn()
const mockOnSelectTool = vi.fn()
const mockOnSelectMultipleTool = vi.fn()

const defaultProps = {
  isShowChooseTool: false,
  hasTrigger: true,
  onShowChange: mockOnShowChange,
  onSelectTool: mockOnSelectTool,
  onSelectMultipleTool: mockOnSelectMultipleTool,
  onDescriptionChange: mockOnDescriptionChange,
}

describe('ToolBaseForm', () => {
  let ToolBaseForm: (typeof import('../tool-base-form'))['default']

  beforeEach(async () => {
    vi.clearAllMocks()
    const mod = await import('../tool-base-form')
    ToolBaseForm = mod.default
  })

  it('should render tool trigger within tool picker', () => {
    render(<ToolBaseForm {...defaultProps} />)

    expect(screen.getByTestId('tool-trigger')).toBeInTheDocument()
    expect(screen.getByTestId('tool-picker')).toBeInTheDocument()
  })

  it('should render description textarea', () => {
    render(<ToolBaseForm {...defaultProps} />)

    expect(screen.getByTestId('description-textarea')).toBeInTheDocument()
  })

  it('should disable textarea when no provider_name in value', () => {
    render(<ToolBaseForm {...defaultProps} />)

    expect(screen.getByTestId('description-textarea')).toBeDisabled()
  })

  it('should enable textarea when value has provider_name', () => {
    const value = { provider_name: 'test-provider', tool_name: 'test', extra: { description: 'Hello' } } as never
    render(<ToolBaseForm {...defaultProps} value={value} />)

    expect(screen.getByTestId('description-textarea')).not.toBeDisabled()
  })

  it('should call onDescriptionChange when textarea content changes', () => {
    const value = { provider_name: 'test-provider', tool_name: 'test', extra: { description: 'Hello' } } as never
    render(<ToolBaseForm {...defaultProps} value={value} />)

    fireEvent.change(screen.getByTestId('description-textarea'), { target: { value: 'Updated' } })
    expect(mockOnDescriptionChange).toHaveBeenCalled()
  })

  it('should show ReadmeEntrance when provider has plugin_unique_identifier', () => {
    const provider = { plugin_unique_identifier: 'test/plugin' } as never
    render(<ToolBaseForm {...defaultProps} currentProvider={provider} />)

    expect(screen.getByTestId('readme-entrance')).toBeInTheDocument()
  })

  it('should not show ReadmeEntrance without plugin_unique_identifier', () => {
    render(<ToolBaseForm {...defaultProps} />)

    expect(screen.queryByTestId('readme-entrance')).not.toBeInTheDocument()
  })
})
