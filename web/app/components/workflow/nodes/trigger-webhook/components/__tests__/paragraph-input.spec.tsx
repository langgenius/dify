import { fireEvent, render, screen } from '@testing-library/react'
import ParagraphInput from '../paragraph-input'

describe('trigger-webhook/paragraph-input', () => {
  it('renders line numbers for multiline content and forwards text changes', () => {
    const onChange = vi.fn()

    render(
      <ParagraphInput
        value={'line-1\nline-2\nline-3\nline-4'}
        onChange={onChange}
        placeholder="Body"
      />,
    )

    expect(screen.getByText('01')).toBeInTheDocument()
    expect(screen.getByText('04')).toBeInTheDocument()
    expect(screen.getByRole('textbox')).toHaveAttribute('rows', '4')

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'updated body' } })

    expect(onChange).toHaveBeenCalledWith('updated body')
  })

  it('keeps the textarea disabled when requested', () => {
    render(
      <ParagraphInput
        value=""
        onChange={vi.fn()}
        disabled
      />,
    )

    expect(screen.getByRole('textbox')).toBeDisabled()
    expect(screen.getByText('03')).toBeInTheDocument()
  })
})
