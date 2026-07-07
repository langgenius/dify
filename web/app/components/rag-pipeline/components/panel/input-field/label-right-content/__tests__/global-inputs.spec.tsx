import { render, screen } from '@testing-library/react'
import GlobalInputs from '../global-inputs'

describe('GlobalInputs', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should render the title and tooltip copy', () => {
    render(<GlobalInputs />)

    expect(screen.getByText('datasetPipeline.inputFieldPanel.globalInputs.title')).toBeInTheDocument()
    expect(screen.getByLabelText('datasetPipeline.inputFieldPanel.globalInputs.tooltip')).toBeInTheDocument()
  })
})
