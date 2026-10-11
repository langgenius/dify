import { render, screen } from '@testing-library/react'
import LargeDataAlert from '../large-data-alert'

describe('LargeDataAlert', () => {
  it('should render the default message and export action when a download URL exists', () => {
    const { container } = render(
      <LargeDataAlert downloadUrl="https://example.com/export.json" className="extra-alert" />,
    )

    expect(screen.getByText('workflowDebug.debug.variableInspect.largeData')).toHaveAttribute(
      'title',
      'workflowDebug.debug.variableInspect.largeData',
    )
    expect(screen.getByText('workflowDebug.debug.variableInspect.export')).toBeInTheDocument()
    expect(container.firstChild).toHaveClass('extra-alert')
  })

  it('should render the no-export message and omit the export action when the URL is missing', () => {
    render(<LargeDataAlert textHasNoExport />)

    expect(
      screen.getByText('workflowDebug.debug.variableInspect.largeDataNoExport'),
    ).toHaveAttribute('title', 'workflowDebug.debug.variableInspect.largeDataNoExport')
    expect(screen.queryByText('workflowDebug.debug.variableInspect.export')).not.toBeInTheDocument()
  })
})
