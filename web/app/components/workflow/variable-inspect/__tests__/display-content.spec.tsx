import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { DisplayContent } from '../display-content'
import { PreviewType } from '../types'

describe('variable inspect display content', () => {
  const baseProps = {
    previewType: PreviewType.Markdown,
    varType: 'string' as never,
    mdString: 'hello markdown',
    readonly: false,
  }

  it('renders markdown code view and forwards text edits', () => {
    const handleTextChange = vi.fn()

    render(<DisplayContent {...baseProps} handleTextChange={handleTextChange} />)

    expect(screen.getByText('MARKDOWN')).toBeInTheDocument()

    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: 'updated markdown' },
    })

    expect(handleTextChange).toHaveBeenCalledWith('updated markdown')
  })

  it('keeps the active view selected when clicking the selected segmented control item', async () => {
    const user = userEvent.setup()
    render(<DisplayContent {...baseProps} />)

    const codeOption = screen.getByRole('radio', {
      name: 'workflow.nodes.templateTransform.code',
    })

    expect(codeOption).toHaveAttribute('aria-checked', 'true')

    await user.click(codeOption)

    expect(codeOption).toHaveAttribute('aria-checked', 'true')
  })
})
