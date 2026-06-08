import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import SupportVarInput from '../index'

describe('SupportVarInput', () => {
  it('should render plain text, highlighted variables, and preserved line breaks', () => {
    render(<SupportVarInput value={'Hello {{user_name}}\nWorld'} />)

    expect(screen.getByText('World').closest('[title]')).toHaveAttribute('title', 'Hello {{user_name}}\nWorld')
    expect(screen.getByText('user_name')).toBeInTheDocument()
    expect(screen.getByText('Hello')).toBeInTheDocument()
    expect(screen.getByText('World')).toBeInTheDocument()
  })

  it('should show the focused child content and call onFocus when activated', async () => {
    const user = userEvent.setup()
    const onFocus = vi.fn()

    render(
      <SupportVarInput
        isFocus
        value="draft"
        onFocus={onFocus}
      >
        <input aria-label="inline-editor" />
      </SupportVarInput>,
    )

    const editor = screen.getByRole('textbox', { name: 'inline-editor' })
    expect(editor).toBeInTheDocument()
    expect(screen.queryByTitle('draft')).not.toBeInTheDocument()

    await user.click(editor)

    expect(onFocus).toHaveBeenCalledTimes(1)
  })

  it('should keep the static preview visible when the input is read-only', () => {
    render(
      <SupportVarInput
        isFocus
        readonly
        value="readonly content"
      >
        <input aria-label="hidden-editor" />
      </SupportVarInput>,
    )

    expect(screen.queryByRole('textbox', { name: 'hidden-editor' })).not.toBeInTheDocument()
    expect(screen.getByTitle('readonly content')).toBeInTheDocument()
  })
})
