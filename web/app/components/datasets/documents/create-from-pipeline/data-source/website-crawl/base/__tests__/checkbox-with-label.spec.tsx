import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import CheckboxWithLabel from '../checkbox-with-label'

vi.mock('@/app/components/base/checkbox', () => ({
  default: ({ checked, onCheck }: { checked: boolean, onCheck: () => void }) => (
    <input type="checkbox" data-testid="checkbox" checked={checked} onChange={onCheck} />
  ),
}))

vi.mock('@/app/components/base/tooltip', () => ({
  default: ({ popupContent }: { popupContent: string }) => <div data-testid="tooltip">{popupContent}</div>,
}))

describe('CheckboxWithLabel', () => {
  const defaultProps = {
    isChecked: false,
    onChange: vi.fn(),
    label: 'Test Label',
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should render label text', () => {
    render(<CheckboxWithLabel {...defaultProps} />)
    expect(screen.getByText('Test Label')).toBeInTheDocument()
  })

  it('should render checkbox', () => {
    render(<CheckboxWithLabel {...defaultProps} />)
    expect(screen.getByTestId('checkbox')).toBeInTheDocument()
  })

  it('should render tooltip when provided', () => {
    render(<CheckboxWithLabel {...defaultProps} tooltip="Help text" />)
    expect(screen.getByTestId('tooltip')).toBeInTheDocument()
  })

  it('should not render tooltip when not provided', () => {
    render(<CheckboxWithLabel {...defaultProps} />)
    expect(screen.queryByTestId('tooltip')).not.toBeInTheDocument()
  })

  it('should apply custom className', () => {
    const { container } = render(<CheckboxWithLabel {...defaultProps} className="custom-cls" />)
    expect(container.querySelector('.custom-cls')).toBeInTheDocument()
  })
})
