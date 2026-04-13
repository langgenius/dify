import { fireEvent, render, screen } from '@testing-library/react'
import DisplayContent from '../display-content'
import { PreviewType } from '../types'

describe('variable inspect display content', () => {
  it('renders markdown code view and forwards text edits', () => {
    const handleTextChange = vi.fn()

    render(
      <DisplayContent
        previewType={PreviewType.Markdown}
        varType={'string' as never}
        mdString="hello markdown"
        readonly={false}
        handleTextChange={handleTextChange}
      />,
    )

    expect(screen.getByText('MARKDOWN')).toBeInTheDocument()

    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: 'updated markdown' },
    })

    expect(handleTextChange).toHaveBeenCalledWith('updated markdown')
  })
})
