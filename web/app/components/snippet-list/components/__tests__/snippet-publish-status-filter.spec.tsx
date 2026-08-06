import { fireEvent, render, screen } from '@testing-library/react'
import SnippetPublishStatusFilter from '../snippet-publish-status-filter'

describe('SnippetPublishStatusFilter', () => {
  it('should render the default published and draft filter label', () => {
    render(<SnippetPublishStatusFilter value="all" onChange={vi.fn()} />)

    expect(
      screen.getByRole('button', { name: /workflow\.common\.published \/ snippet\.draft/i }),
    ).toBeInTheDocument()
  })

  it('should emit the selected publish status from the dropdown', () => {
    const onChange = vi.fn()
    render(<SnippetPublishStatusFilter value="all" onChange={onChange} />)

    fireEvent.click(
      screen.getByRole('button', { name: /workflow\.common\.published \/ snippet\.draft/i }),
    )
    fireEvent.click(screen.getByRole('menuitemradio', { name: /workflow\.common\.published/i }))

    expect(onChange).toHaveBeenCalledWith('published')
  })

  it('should render the selected draft status label', () => {
    render(<SnippetPublishStatusFilter value="draft" onChange={vi.fn()} />)

    expect(screen.getByRole('button', { name: /snippet\.draft/i })).toBeInTheDocument()
  })
})
