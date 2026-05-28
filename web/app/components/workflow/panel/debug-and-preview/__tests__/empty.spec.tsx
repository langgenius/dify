import { render, screen } from '@testing-library/react'
import Empty from '../empty'

describe('debug-and-preview Empty', () => {
  it('renders the preview placeholder', () => {
    render(<Empty />)

    expect(screen.getByText('workflow.common.previewPlaceholder')).toBeInTheDocument()
  })
})
