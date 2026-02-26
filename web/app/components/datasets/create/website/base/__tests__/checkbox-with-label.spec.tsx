import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import CheckboxWithLabel from '../checkbox-with-label'

vi.mock('@/app/components/base/tooltip', () => ({
  default: ({ popupContent }: { popupContent?: React.ReactNode }) => <div data-testid="tooltip">{popupContent}</div>,
}))

describe('CheckboxWithLabel', () => {
  const onChange = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should render label', () => {
    render(<CheckboxWithLabel isChecked={false} onChange={onChange} label="Accept terms" />)
    expect(screen.getByText('Accept terms')).toBeInTheDocument()
  })

  it('should render tooltip when provided', () => {
    render(
      <CheckboxWithLabel
        isChecked={false}
        onChange={onChange}
        label="Option"
        tooltip="Help text"
      />,
    )
    expect(screen.getByTestId('tooltip')).toBeInTheDocument()
  })

  it('should not render tooltip when not provided', () => {
    render(<CheckboxWithLabel isChecked={false} onChange={onChange} label="Option" />)
    expect(screen.queryByTestId('tooltip')).not.toBeInTheDocument()
  })

  it('should toggle checked state on checkbox click', () => {
    render(<CheckboxWithLabel isChecked={false} onChange={onChange} label="Toggle" testId="my-check" />)
    fireEvent.click(screen.getByTestId('checkbox-my-check'))
    expect(onChange).toHaveBeenCalledWith(true)
  })
})
