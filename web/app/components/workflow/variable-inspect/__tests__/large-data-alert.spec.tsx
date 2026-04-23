import { render, screen } from '@testing-library/react'
import LargeDataAlert from '../large-data-alert'

describe('LargeDataAlert', () => {
  it('should render the default message and export action when a download URL exists', () => {
    const { container } = render(<LargeDataAlert downloadUrl="https://example.com/export.json" className="extra-alert" />)

    expect(screen.getByText('workflow.debug.variableInspect.largeData')).toBeInTheDocument()
    expect(screen.getByText('workflow.debug.variableInspect.export')).toBeInTheDocument()
    expect(container.firstChild).toHaveClass('extra-alert')
  })

  it('should render the no-export message and omit the export action when the URL is missing', () => {
    render(<LargeDataAlert textHasNoExport />)

    expect(screen.getByText('workflow.debug.variableInspect.largeDataNoExport')).toBeInTheDocument()
    expect(screen.queryByText('workflow.debug.variableInspect.export')).not.toBeInTheDocument()
  })
})
