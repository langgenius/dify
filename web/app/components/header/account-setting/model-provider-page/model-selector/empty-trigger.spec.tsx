import { render, screen } from '@testing-library/react'
import EmptyTrigger from './empty-trigger'

describe('EmptyTrigger', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should render configure model text', () => {
    render(<EmptyTrigger open={false} />)
    expect(screen.getByText('plugin.detailPanel.configureModel')).toBeInTheDocument()
  })
})
