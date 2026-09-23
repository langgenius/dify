import type * as React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import SummaryText from '../summary-text'

vi.mock('react-textarea-autosize', () => ({
  default: (props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) => (
    <textarea data-testid="textarea" {...props} />
  ),
}))

describe('SummaryText', () => {
  const onChange = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should render summary heading', () => {
    render(<SummaryText />)
    expect(screen.getByText('datasetDocuments.segment.summary')).toBeInTheDocument()
  })

  it('should render value in textarea', () => {
    render(<SummaryText value="My summary" onChange={onChange} />)
    expect(screen.getByTestId('textarea')).toHaveValue('My summary')
  })

  it('should render empty string when value is undefined', () => {
    render(<SummaryText onChange={onChange} />)
    expect(screen.getByTestId('textarea')).toHaveValue('')
  })

  it('should call onChange when text changes', () => {
    render(<SummaryText value="" onChange={onChange} />)
    fireEvent.change(screen.getByTestId('textarea'), { target: { value: 'new summary' } })
    expect(onChange).toHaveBeenCalledWith('new summary')
  })

  it('should disable textarea when disabled', () => {
    render(<SummaryText value="text" disabled />)
    expect(screen.getByTestId('textarea')).toBeDisabled()
  })

  it('shows the focus ring only after tabbing into the summary', async () => {
    const user = userEvent.setup()
    render(
      <>
        <button type="button">Before summary</button>
        <SummaryText />
      </>,
    )

    const textarea = screen.getByRole('textbox')
    await user.click(textarea)
    expect(textarea).toHaveAttribute('data-tab-focus', 'false')

    await user.click(screen.getByRole('button', { name: 'Before summary' }))
    await user.tab()
    expect(textarea).toHaveFocus()
    expect(textarea).toHaveAttribute('data-tab-focus', 'true')

    await user.click(textarea)
    expect(textarea).toHaveAttribute('data-tab-focus', 'false')
  })
})
