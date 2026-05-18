import { render, screen } from '@testing-library/react'
import FooterTips from '../footer-tips'

describe('FooterTips', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should render the localized footer copy', () => {
    render(<FooterTips />)

    expect(screen.getByText('datasetPipeline.testRun.tooltip')).toBeInTheDocument()
  })
})
